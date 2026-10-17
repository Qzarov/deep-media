import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Insertable } from 'kysely';
import { R_OK } from 'node:constants';
import { Stats } from 'node:fs';
import path, { isAbsolute, parse } from 'node:path';
import picomatch from 'picomatch';
import { JOBS_LIBRARY_PAGINATION_SIZE } from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { OnEvent, OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  CreateLibraryDto,
  LibraryAssetMoveDto,
  LibraryAssetMoveError,
  LibraryAssetMoveResponseDto,
  LibraryAssetMoveResultDto,
  LibraryResponseDto,
  LibraryStatsResponseDto,
  mapLibrary,
  ScanLibraryDto,
  UpdateLibraryDto,
  ValidateLibraryDto,
  ValidateLibraryImportPathResponseDto,
  ValidateLibraryResponseDto,
} from 'src/dtos/library.dto';
import {
  AssetStatus,
  AssetType,
  ChecksumAlgorithm,
  CronJob,
  DatabaseLock,
  ImmichWorker,
  JobName,
  JobStatus,
  QueueName,
} from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { AssetSyncResult } from 'src/repositories/library.repository';
import { AssetTable } from 'src/schema/tables/asset.table';
import { BaseService } from 'src/services/base.service';
import { JobOf } from 'src/types';
import { mimeTypes } from 'src/utils/mime-types';
import { handlePromiseError } from 'src/utils/misc';

@Injectable()
export class LibraryService extends BaseService {
  private watchLibraries = false;
  private lock = false;
  private watchers: Record<string, () => Promise<void>> = {};

  @OnEvent({ name: 'ConfigInit', workers: [ImmichWorker.Microservices] })
  async onConfigInit({
    newConfig: {
      library: { watch, scan },
    },
  }: ArgOf<'ConfigInit'>) {
    // This ensures that library watching only occurs in one microservice
    this.lock = await this.databaseRepository.tryLock(DatabaseLock.Library);

    this.watchLibraries = this.lock && watch.enabled;

    if (this.lock) {
      this.cronRepository.create({
        name: CronJob.LibraryScan,
        expression: scan.cronExpression,
        onTick: () => handlePromiseError(this.jobRepository.queue({ name: JobName.LibraryScanQueueAll }), this.logger),
        start: scan.enabled,
      });
    }

    if (this.watchLibraries) {
      await this.watchAll();
    }
  }

  @OnEvent({ name: 'ConfigUpdate', server: true })
  async onConfigUpdate({ newConfig: { library } }: ArgOf<'ConfigUpdate'>) {
    if (!this.lock) {
      return;
    }

    this.cronRepository.update({
      name: CronJob.LibraryScan,
      expression: library.scan.cronExpression,
      start: library.scan.enabled,
    });

    if (library.watch.enabled !== this.watchLibraries) {
      // Watch configuration changed, update accordingly
      this.watchLibraries = library.watch.enabled;
      await (this.watchLibraries ? this.watchAll() : this.unwatchAll());
    }
  }

  private async watch(id: string): Promise<boolean> {
    if (!this.watchLibraries) {
      return false;
    }

    const library = await this.findOrFail(id);
    if (library.importPaths.length === 0) {
      return false;
    }

    await this.unwatch(id);

    this.logger.log(`Starting to watch library ${library.id} with import path(s) ${library.importPaths}`);

    const matcher = picomatch(`**/*{${mimeTypes.getSupportedFileExtensions().join(',')}}`, {
      nocase: true,
      ignore: library.exclusionPatterns,
    });

    let _resolve: () => void;
    const ready$ = new Promise<void>((resolve) => (_resolve = resolve));

    const handler = async (event: string, path: string) => {
      if (matcher(path)) {
        this.logger.debug(`File ${event} event received for ${path} in library ${library.id}}`);
        await this.jobRepository.queue({
          name: JobName.LibrarySyncFiles,
          data: { libraryId: library.id, paths: [path] },
        });
      } else {
        this.logger.verbose(`Ignoring file ${event} event for ${path} in library ${library.id}`);
      }
    };

    const deletionHandler = async (path: string) => {
      this.logger.debug(`File unlink event received for ${path} in library ${library.id}}`);
      await this.jobRepository.queue({
        name: JobName.LibraryRemoveAsset,
        data: { libraryId: library.id, paths: [path] },
      });
    };

    this.watchers[id] = this.storageRepository.watch(
      library.importPaths,
      {
        usePolling: false,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 5000,
          pollInterval: 1000,
        },
      },
      {
        onReady: () => _resolve(),
        onAdd: (path) => {
          return handlePromiseError(handler('add', path), this.logger);
        },
        onChange: (path) => {
          return handlePromiseError(handler('change', path), this.logger);
        },
        onUnlink: (path) => {
          return handlePromiseError(deletionHandler(path), this.logger);
        },
        onError: (error) => {
          this.logger.error(`Library watcher for library ${library.id} encountered error: ${error}`);
        },
      },
    );

    // Wait for the watcher to initialize before returning
    await ready$;

    return true;
  }

  async unwatch(id: string) {
    if (this.watchers[id]) {
      await this.watchers[id]();
      delete this.watchers[id];
    }
  }

  @OnEvent({ name: 'AppShutdown' })
  async onShutdown() {
    await this.unwatchAll();
  }

  private async unwatchAll() {
    if (!this.lock) {
      return false;
    }

    for (const id in this.watchers) {
      await this.unwatch(id);
    }
  }

  async watchAll() {
    if (!this.lock) {
      return false;
    }

    const libraries = await this.libraryRepository.getAll(false);
    for (const library of libraries) {
      await this.watch(library.id);
    }
  }

  async getStatistics(id: string): Promise<LibraryStatsResponseDto> {
    const statistics = await this.libraryRepository.getStatistics(id);
    if (!statistics) {
      throw new BadRequestException(`Library ${id} not found`);
    }
    return statistics;
  }

  async get(id: string): Promise<LibraryResponseDto> {
    const library = await this.findOrFail(id);
    return mapLibrary(library);
  }

  async getAll(): Promise<LibraryResponseDto[]> {
    const libraries = await this.libraryRepository.getAll(false);
    return libraries.map((library) => mapLibrary(library));
  }

  @OnJob({ name: JobName.LibraryDeleteCheck, queue: QueueName.Library })
  async handleQueueCleanup(): Promise<JobStatus> {
    this.logger.log('Checking for any libraries pending deletion...');
    const pendingDeletions = await this.libraryRepository.getAllDeleted();
    if (pendingDeletions.length > 0) {
      const libraryString = pendingDeletions.length === 1 ? 'library' : 'libraries';
      this.logger.log(`Found ${pendingDeletions.length} ${libraryString} pending deletion, cleaning up...`);

      await this.jobRepository.queueAll(
        pendingDeletions.map((libraryToDelete) => ({ name: JobName.LibraryDelete, data: { id: libraryToDelete.id } })),
      );
    }

    return JobStatus.Success;
  }

  async create(dto: CreateLibraryDto): Promise<LibraryResponseDto> {
    const library = await this.libraryRepository.create({
      ownerId: dto.ownerId,
      name: dto.name ?? 'New External Library',
      importPaths: dto.importPaths ?? [],
      exclusionPatterns: dto.exclusionPatterns ?? [
        '**/@eaDir/**',
        '**/._*',
        '**/#recycle/**',
        '**/#snapshot/**',
        '**/.stversions/**',
        '**/.stfolder/**',
      ],
    });
    return mapLibrary(library);
  }

  @OnJob({ name: JobName.LibrarySyncFiles, queue: QueueName.Library })
  async handleSyncFiles(job: JobOf<JobName.LibrarySyncFiles>): Promise<JobStatus> {
    const library = await this.libraryRepository.get(job.libraryId);
    // We need to check if the library still exists as it could have been deleted after the scan was queued
    if (!library) {
      this.logger.debug(`Library ${job.libraryId} not found, skipping file import`);
      return JobStatus.Failed;
    } else if (library.deletedAt) {
      this.logger.debug(`Library ${job.libraryId} is deleted, won't import assets into it`);
      return JobStatus.Failed;
    }

    const assetImports: Insertable<AssetTable>[] = [];
    await Promise.all(
      job.paths.map((path) =>
        this.processEntity(path, library.ownerId, job.libraryId)
          .then((asset) => assetImports.push(asset))
          .catch((error: any) => this.logger.error(`Error processing ${path} for library ${job.libraryId}: ${error}`)),
      ),
    );

    const assetIds = await this.assetRepository.createAll(assetImports);

    const progressMessage =
      job.progressCounter && job.totalAssets
        ? `(${job.progressCounter} of ${job.totalAssets})`
        : `(${job.progressCounter} done so far)`;

    this.logger.log(`Imported ${assetIds.length} ${progressMessage} file(s) into library ${job.libraryId}`);

    await this.queuePostSyncJobs(assetIds);

    return JobStatus.Success;
  }

  private async validateImportPath(importPath: string): Promise<ValidateLibraryImportPathResponseDto> {
    const validation = new ValidateLibraryImportPathResponseDto();
    validation.importPath = importPath;
    validation.isValid = false;

    if (StorageCore.isImmichPath(importPath)) {
      validation.message = 'Cannot use media upload folder for external libraries';
      return validation;
    }

    if (!isAbsolute(importPath)) {
      validation.message = `Import path must be absolute, try ${path.resolve(importPath)}`;
      return validation;
    }

    try {
      const stat = await this.storageRepository.stat(importPath);
      if (!stat.isDirectory()) {
        validation.message = 'Not a directory';
        return validation;
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        validation.message = 'Path does not exist (ENOENT)';
        return validation;
      }
      validation.message = String(error);
      return validation;
    }

    const access = await this.storageRepository.checkFileExists(importPath, R_OK);

    if (!access) {
      validation.message = 'Lacking read permission for folder';
      return validation;
    }

    validation.isValid = true;
    return validation;
  }

  async validate(id: string, dto: ValidateLibraryDto): Promise<ValidateLibraryResponseDto> {
    const importPaths = await Promise.all(
      (dto.importPaths || []).map((importPath) => this.validateImportPath(importPath)),
    );
    return { importPaths };
  }

  async update(id: string, dto: UpdateLibraryDto): Promise<LibraryResponseDto> {
    await this.findOrFail(id);

    if (dto.importPaths) {
      const validation = await this.validate(id, { importPaths: dto.importPaths });
      if (validation.importPaths) {
        for (const path of validation.importPaths) {
          if (!path.isValid) {
            throw new BadRequestException(`Invalid import path: ${path.message}`);
          }
        }
      }
    }

    const library = await this.libraryRepository.update(id, dto);
    return mapLibrary(library);
  }

  async delete(id: string) {
    await this.findOrFail(id);

    if (this.watchLibraries) {
      await this.unwatch(id);
    }

    await this.libraryRepository.softDelete(id);
    await this.jobRepository.queue({ name: JobName.LibraryDelete, data: { id } });
  }

  @OnJob({ name: JobName.LibraryDelete, queue: QueueName.Library })
  async handleDeleteLibrary(job: JobOf<JobName.LibraryDelete>): Promise<JobStatus> {
    const libraryId = job.id;

    await this.assetRepository.updateByLibraryId(libraryId, { deletedAt: new Date() });

    let assetsFound = false;
    let chunk: string[] = [];

    const queueChunk = async () => {
      if (chunk.length > 0) {
        assetsFound = true;
        this.logger.debug(`Queueing deletion of ${chunk.length} asset(s) in library ${libraryId}`);
        await this.jobRepository.queueAll(
          chunk.map((id) => ({ name: JobName.AssetDelete, data: { id, deleteOnDisk: false } })),
        );
        chunk = [];
      }
    };

    this.logger.debug(`Will delete all assets in library ${libraryId}`);
    const assets = this.libraryRepository.streamAssetIds(libraryId);
    for await (const asset of assets) {
      chunk.push(asset.id);

      if (chunk.length >= JOBS_LIBRARY_PAGINATION_SIZE) {
        await queueChunk();
      }
    }

    await queueChunk();

    if (!assetsFound) {
      this.logger.log(`Deleting library ${libraryId}`);
      await this.libraryRepository.delete(libraryId);
    }

    return JobStatus.Success;
  }

  private async processEntity(filePath: string, ownerId: string, libraryId: string) {
    const assetPath = path.normalize(filePath);
    const stat = await this.storageRepository.stat(assetPath);

    return {
      ownerId,
      libraryId,
      checksum: this.cryptoRepository.hashSha1(`path:${assetPath}`),
      checksumAlgorithm: ChecksumAlgorithm.sha1Path,
      originalPath: assetPath,

      fileCreatedAt: stat.mtime,
      fileModifiedAt: stat.mtime,
      localDateTime: stat.mtime,
      type: mimeTypes.isVideo(assetPath) ? AssetType.Video : AssetType.Image,
      originalFileName: parse(assetPath).base,
      isExternal: true,
      livePhotoVideoId: null,
    };
  }

  async queuePostSyncJobs(assetIds: string[]) {
    this.logger.debug(`Queuing sidecar discovery for ${assetIds.length} asset(s)`);

    // We queue a sidecar discovery which, in turn, queues metadata extraction
    await this.jobRepository.queueAll(
      assetIds.map((assetId) => ({
        name: JobName.SidecarCheck,
        data: { id: assetId, source: 'upload' },
      })),
    );
  }

  async queueScan(id: string, dto: ScanLibraryDto = {}) {
    const library = await this.findOrFail(id);

    let paths: string[] | undefined;
    if (dto.paths) {
      paths = this.resolveScanPaths(library.importPaths, dto.paths);
      this.logger.log(`Starting to scan ${paths.length} path(s) of library ${id}`);
    } else {
      this.logger.log(`Starting to scan library ${id}`);
    }

    await this.jobRepository.queue({ name: JobName.LibrarySyncFilesQueueAll, data: { id, paths } });
    await this.jobRepository.queue({ name: JobName.LibrarySyncAssetsQueueAll, data: { id, paths } });
  }

  /**
   * Q Space: validates the paths of a partial scan. They must be absolute and inside one of the import paths.
   * They do not have to exist: a scan of a removed folder marks its assets offline.
   */
  private resolveScanPaths(importPaths: string[], paths: string[]): string[] {
    const invalid: string[] = [];
    const resolved = new Set<string>();
    for (const value of paths) {
      const normalized = normalizePath(value);
      if (!isAbsolute(value) || !isInsideAny(normalized, importPaths)) {
        invalid.push(value);
        continue;
      }
      resolved.add(normalized);
    }

    if (invalid.length > 0) {
      throw new BadRequestException(
        `Paths must be absolute and inside the library import paths: ${invalid.join(', ')}`,
      );
    }

    // a path inside another requested path is already covered by it
    const sorted = [...resolved].sort();
    return sorted.filter((value) => !sorted.some((other) => other !== value && isInside(value, other)));
  }

  async queueScanAll() {
    await this.jobRepository.queue({ name: JobName.LibraryScanQueueAll, data: {} });
  }

  @OnJob({ name: JobName.LibraryScanQueueAll, queue: QueueName.Library })
  async handleQueueScanAll(): Promise<JobStatus> {
    this.logger.log(`Initiating scan of all external libraries...`);

    await this.jobRepository.queue({ name: JobName.LibraryDeleteCheck, data: {} });

    const libraries = await this.libraryRepository.getAll(true);

    await this.jobRepository.queueAll(
      libraries.map((library) => ({
        name: JobName.LibrarySyncFilesQueueAll,
        data: {
          id: library.id,
        },
      })),
    );
    await this.jobRepository.queueAll(
      libraries.map((library) => ({
        name: JobName.LibrarySyncAssetsQueueAll,
        data: {
          id: library.id,
        },
      })),
    );

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.LibrarySyncAssets, queue: QueueName.Library })
  async handleSyncAssets(job: JobOf<JobName.LibrarySyncAssets>): Promise<JobStatus> {
    const assets = await this.assetJobRepository.getForSyncAssets(job.assetIds);

    const assetIdsToOffline: string[] = [];
    const trashedAssetIdsToOffline: string[] = [];
    const assetIdsToOnline: string[] = [];
    const trashedAssetIdsToOnline: string[] = [];
    const assetIdsToUpdate: string[] = [];

    this.logger.debug(`Checking batch of ${assets.length} existing asset(s) in library ${job.libraryId}`);

    const stats = await Promise.all(
      assets.map((asset) => this.storageRepository.stat(asset.originalPath).catch(() => null)),
    );

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const stat = stats[i];
      const action = this.checkExistingAsset(asset, stat);
      switch (action) {
        case AssetSyncResult.OFFLINE: {
          if (asset.status === AssetStatus.Trashed) {
            trashedAssetIdsToOffline.push(asset.id);
          } else {
            assetIdsToOffline.push(asset.id);
          }
          break;
        }
        case AssetSyncResult.UPDATE: {
          assetIdsToUpdate.push(asset.id);
          break;
        }
        case AssetSyncResult.CHECK_OFFLINE: {
          const isInImportPath = job.importPaths.find((path) => asset.originalPath.startsWith(path));

          if (!isInImportPath) {
            this.logger.verbose(
              `Offline asset ${asset.originalPath} is still not in any import path, keeping offline in library ${job.libraryId}`,
            );
            break;
          }

          const isExcluded = job.exclusionPatterns.some((pattern) => picomatch.isMatch(asset.originalPath, pattern));

          if (!isExcluded) {
            this.logger.debug(`Offline asset ${asset.originalPath} is now online in library ${job.libraryId}`);
            if (asset.status === AssetStatus.Trashed) {
              trashedAssetIdsToOnline.push(asset.id);
            } else {
              assetIdsToOnline.push(asset.id);
            }
            break;
          }

          this.logger.verbose(
            `Offline asset ${asset.originalPath} is in an import path but still covered by exclusion pattern, keeping offline in library ${job.libraryId}`,
          );

          break;
        }
      }
    }

    const promises = [];
    if (assetIdsToOffline.length > 0) {
      promises.push(this.assetRepository.updateAll(assetIdsToOffline, { isOffline: true, deletedAt: new Date() }));
    }

    if (trashedAssetIdsToOffline.length > 0) {
      promises.push(this.assetRepository.updateAll(trashedAssetIdsToOffline, { isOffline: true }));
    }

    if (assetIdsToOnline.length > 0) {
      promises.push(this.assetRepository.updateAll(assetIdsToOnline, { isOffline: false, deletedAt: null }));
    }

    if (trashedAssetIdsToOnline.length > 0) {
      promises.push(this.assetRepository.updateAll(trashedAssetIdsToOnline, { isOffline: false }));
    }

    if (assetIdsToUpdate.length > 0) {
      promises.push(this.queuePostSyncJobs(assetIdsToUpdate));
    }

    await Promise.all(promises);

    const remainingCount = assets.length - assetIdsToOffline.length - assetIdsToUpdate.length - assetIdsToOnline.length;
    const cumulativePercentage = ((100 * job.progressCounter) / job.totalAssets).toFixed(1);
    this.logger.log(
      `Checked existing asset(s): ${assetIdsToOffline.length + trashedAssetIdsToOffline.length} offlined, ${assetIdsToOnline.length + trashedAssetIdsToOnline.length} onlined, ${assetIdsToUpdate.length} updated, ${remainingCount} unchanged of current batch of ${assets.length} (Total progress: ${job.progressCounter} of ${job.totalAssets}, ${cumulativePercentage} %) in library ${job.libraryId}.`,
    );

    return JobStatus.Success;
  }

  private checkExistingAsset(
    asset: {
      isOffline: boolean;
      libraryId: string | null;
      originalPath: string;
      status: AssetStatus;
      fileModifiedAt: Date;
    },
    stat: Stats | null,
  ): AssetSyncResult {
    if (!stat) {
      // File not found on disk or permission error
      if (asset.isOffline) {
        this.logger.verbose(
          `Asset ${asset.originalPath} is still not accessible, keeping offline in library ${asset.libraryId}`,
        );
        return AssetSyncResult.DO_NOTHING;
      }

      this.logger.debug(
        `Asset ${asset.originalPath} is no longer on disk or is inaccessible because of permissions, marking offline in library ${asset.libraryId}`,
      );
      return AssetSyncResult.OFFLINE;
    }

    if (asset.isOffline && asset.status !== AssetStatus.Deleted) {
      // Only perform the expensive check if the asset is offline
      return AssetSyncResult.CHECK_OFFLINE;
    }

    if (asset.status === AssetStatus.Deleted) {
      // Q Space: a tombstone (deleted asset whose file is still on disk) must not be re-processed
      return AssetSyncResult.DO_NOTHING;
    }

    if (stat.mtime.valueOf() !== asset.fileModifiedAt.valueOf()) {
      this.logger.verbose(`Asset ${asset.originalPath} needs metadata extraction in library ${asset.libraryId}`);

      return AssetSyncResult.UPDATE;
    }

    return AssetSyncResult.DO_NOTHING;
  }

  @OnJob({ name: JobName.LibrarySyncFilesQueueAll, queue: QueueName.Library })
  async handleQueueSyncFiles(job: JobOf<JobName.LibrarySyncFilesQueueAll>): Promise<JobStatus> {
    const library = await this.libraryRepository.get(job.id);
    if (!library) {
      this.logger.debug(`Library ${job.id} not found, skipping refresh`);
      return JobStatus.Skipped;
    }

    this.logger.debug(`Validating import paths for library ${library.id}...`);

    const validImportPaths: string[] = [];

    for (const importPath of library.importPaths) {
      const validation = await this.validateImportPath(importPath);
      if (validation.isValid) {
        validImportPaths.push(path.normalize(importPath));
      } else {
        this.logger.warn(`Skipping invalid import path: ${importPath}. Reason: ${validation.message}`);
      }
    }

    if (validImportPaths.length === 0) {
      this.logger.warn(`No valid import paths found for library ${library.id}`);

      return JobStatus.Skipped;
    }

    let pathsToCrawl = validImportPaths;
    const files: string[] = [];
    if (job.paths) {
      // Q Space: partial scan of the given folders (or single files) only
      pathsToCrawl = [];
      for (const scanPath of job.paths) {
        if (!isInsideAny(scanPath, validImportPaths)) {
          this.logger.warn(`Skipping scan path outside of the valid import paths: ${scanPath}`);
          continue;
        }

        const stat = await this.storageRepository.stat(scanPath).catch(() => null);
        if (stat?.isDirectory()) {
          pathsToCrawl.push(scanPath);
        } else if (stat?.isFile() && this.isImportableFile(scanPath, validImportPaths, library.exclusionPatterns)) {
          files.push(scanPath);
        }
      }
    }

    const pathsOnDisk = this.storageRepository.walk({
      pathsToCrawl,
      includeHidden: false,
      exclusionPatterns: library.exclusionPatterns,
      take: JOBS_LIBRARY_PAGINATION_SIZE,
    });

    let importCount = 0;
    let crawlCount = 0;

    this.logger.log(`Starting disk crawl of ${pathsToCrawl.length} path(s) for library ${library.id}...`);

    async function* withFiles() {
      if (files.length > 0) {
        yield files;
      }
      yield* pathsOnDisk;
    }

    for await (const pathBatch of withFiles()) {
      crawlCount += pathBatch.length;
      const paths = await this.assetRepository.filterNewExternalAssetPaths(library.id, pathBatch);

      if (paths.length > 0) {
        importCount += paths.length;

        await this.jobRepository.queue({
          name: JobName.LibrarySyncFiles,
          data: {
            libraryId: library.id,
            paths,
            progressCounter: crawlCount,
          },
        });
      }

      this.logger.log(
        `Crawled ${crawlCount} file(s) so far: ${paths.length} of current batch of ${pathBatch.length} will be imported to library ${library.id}...`,
      );
    }

    this.logger.log(
      `Finished disk crawl, ${crawlCount} file(s) found on disk and queued ${importCount} file(s) for import into ${library.id}`,
    );

    if (!job.paths) {
      await this.libraryRepository.update(job.id, { refreshedAt: new Date() });
    }

    return JobStatus.Success;
  }

  private isImportableFile(filePath: string, importPaths: string[], exclusionPatterns: string[]) {
    if (!mimeTypes.isAsset(filePath)) {
      return false;
    }

    // the crawler skips hidden files and folders below the import path as well
    const importPath = importPaths.find((value) => isInside(filePath, value));
    const relativePath = importPath ? path.relative(importPath, filePath) : filePath;
    if (relativePath.split('/').some((segment) => segment.startsWith('.'))) {
      return false;
    }

    return !exclusionPatterns.some((pattern) => picomatch.isMatch(filePath, pattern, { nocase: true }));
  }

  @OnJob({ name: JobName.LibraryRemoveAsset, queue: QueueName.Library })
  async handleAssetRemoval(job: JobOf<JobName.LibraryRemoveAsset>): Promise<JobStatus> {
    // This is only for handling file unlink events via the file watcher
    this.logger.verbose(`Deleting asset(s) ${job.paths} from library ${job.libraryId}`);
    for (const assetPath of job.paths) {
      const asset = await this.assetRepository.getByLibraryIdAndOriginalPath(job.libraryId, assetPath);
      if (asset) {
        await this.assetRepository.remove(asset);
      }
    }

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.LibrarySyncAssetsQueueAll, queue: QueueName.Library })
  async handleQueueSyncAssets(job: JobOf<JobName.LibrarySyncAssetsQueueAll>): Promise<JobStatus> {
    const library = await this.libraryRepository.get(job.id);
    if (!library) {
      return JobStatus.Skipped;
    }

    if (job.paths) {
      return this.queueSyncAssetsForPaths(library, job.paths);
    }

    const assetCount = await this.assetRepository.getLibraryAssetCount(job.id);
    if (!assetCount) {
      this.logger.log(`Library ${library.id} is empty, no need to check assets`);
      return JobStatus.Success;
    }

    this.logger.log(
      `Checking ${assetCount} asset(s) against import paths and exclusion patterns in library ${library.id}...`,
    );

    const offlineResult = await this.assetRepository.detectOfflineExternalAssets(
      library.id,
      library.importPaths,
      library.exclusionPatterns,
    );

    const affectedAssetCount = Number(offlineResult.numUpdatedRows);

    this.logger.log(
      `${affectedAssetCount} asset(s) out of ${assetCount} were offlined due to import paths and/or exclusion pattern(s) in library ${library.id}`,
    );

    if (affectedAssetCount === assetCount) {
      return JobStatus.Success;
    }

    let chunk: string[] = [];
    let count = 0;

    const queueChunk = async () => {
      if (chunk.length > 0) {
        count += chunk.length;

        await this.jobRepository.queue({
          name: JobName.LibrarySyncAssets,
          data: {
            libraryId: library.id,
            importPaths: library.importPaths,
            exclusionPatterns: library.exclusionPatterns,
            assetIds: chunk.map((id) => id),
            progressCounter: count,
            totalAssets: assetCount,
          },
        });
        chunk = [];

        const completePercentage = ((100 * count) / assetCount).toFixed(1);

        this.logger.log(
          `Queued check of ${count} of ${assetCount} (${completePercentage} %) existing asset(s) so far in library ${library.id}`,
        );
      }
    };

    this.logger.log(`Scanning library ${library.id} for assets missing from disk...`);
    const existingAssets = this.libraryRepository.streamAssetIds(library.id);

    for await (const asset of existingAssets) {
      chunk.push(asset.id);
      if (chunk.length === JOBS_LIBRARY_PAGINATION_SIZE) {
        await queueChunk();
      }
    }

    await queueChunk();

    this.logger.log(`Finished queuing ${count} asset check(s) for library ${library.id}`);

    return JobStatus.Success;
  }

  /**
   * Q Space: files were moved or renamed on disk by the storage owner. Updates the path of the existing assets so
   * that they keep their ids (and with them faces, embeddings, albums, favorites, edits). Each item succeeds or
   * fails on its own; items are applied in request order.
   */
  async moveAssets(auth: AuthDto, id: string, dto: LibraryAssetMoveDto): Promise<LibraryAssetMoveResponseDto> {
    const library = await this.findOrFail(id);
    if (!auth.user.isAdmin && library.ownerId !== auth.user.id) {
      throw new ForbiddenException('Only an admin or the owner of the library can move its assets');
    }

    const results: LibraryAssetMoveResultDto[] = [];
    const movedIds: string[] = [];
    const filesToDelete: string[] = [];

    const tasks: Array<{ result: LibraryAssetMoveResultDto; assetId?: string; fromPath?: string }> = [];
    if (dto.items) {
      for (const item of dto.items) {
        tasks.push({
          result: { assetId: item.assetId, fromPath: item.fromPath, toPath: item.toPath, success: false },
          assetId: item.assetId,
          fromPath: item.fromPath === undefined ? undefined : normalizePath(item.fromPath),
        });
      }
    } else {
      const fromPrefix = normalizePath(dto.fromPrefix!);
      const toPrefix = normalizePath(dto.toPrefix!);
      if (!isAbsolute(fromPrefix) || !isAbsolute(toPrefix) || !isInsideAny(toPrefix, library.importPaths)) {
        throw new BadRequestException('fromPrefix and toPrefix must be absolute and toPrefix inside the import paths');
      }

      const assets = await this.libraryRepository.getAssetsForMoveByPrefix(library.id, fromPrefix);
      for (const asset of assets) {
        const toPath = toPrefix + asset.originalPath.slice(fromPrefix.length);
        tasks.push({
          result: { assetId: asset.id, fromPath: asset.originalPath, toPath, success: false },
          assetId: asset.id,
        });
      }
    }

    for (const task of tasks) {
      const { result } = task;
      try {
        const error = await this.moveAsset(library, task, result, movedIds, filesToDelete);
        if (error) {
          result.error = error.code;
          result.message = error.message;
        } else {
          result.success = true;
        }
      } catch (error: any) {
        this.logger.error(`Unable to move asset ${task.assetId ?? task.fromPath} in library ${library.id}: ${error}`);
        result.error = LibraryAssetMoveError.Failed;
        result.message = String(error?.message ?? error);
      }
      results.push(result);
    }

    if (filesToDelete.length > 0) {
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: filesToDelete } });
    }

    if (movedIds.length > 0) {
      // re-discover the sidecar of the moved originals (read only)
      await this.jobRepository.queueAll(
        movedIds.map((assetId) => ({ name: JobName.SidecarCheck, data: { id: assetId } })),
      );
    }

    const moved = results.filter(({ success }) => success).length;
    this.logger.log(`Moved ${moved} of ${results.length} asset(s) in library ${library.id}`);

    return { moved, failed: results.length - moved, items: results };
  }

  private async moveAsset(
    library: { id: string; importPaths: string[]; exclusionPatterns: string[] },
    task: { assetId?: string; fromPath?: string },
    result: LibraryAssetMoveResultDto,
    movedIds: string[],
    filesToDelete: string[],
  ): Promise<{ code: LibraryAssetMoveError; message: string } | undefined> {
    const asset = await this.libraryRepository.getAssetForMove(library.id, {
      id: task.assetId,
      originalPath: task.fromPath,
    });
    if (!asset || !asset.isExternal) {
      return { code: LibraryAssetMoveError.NotFound, message: 'Asset not found in this library' };
    }

    result.assetId = asset.id;
    result.fromPath = asset.originalPath;

    const toPath = normalizePath(result.toPath);
    if (!isAbsolute(result.toPath) || !isInsideAny(toPath, library.importPaths)) {
      return {
        code: LibraryAssetMoveError.InvalidPath,
        message: 'toPath must be absolute and inside the import paths',
      };
    }

    if (!mimeTypes.isAsset(toPath)) {
      return { code: LibraryAssetMoveError.InvalidPath, message: 'toPath is not a supported media file' };
    }

    if (library.exclusionPatterns.some((pattern) => picomatch.isMatch(toPath, pattern, { nocase: true }))) {
      return { code: LibraryAssetMoveError.InvalidPath, message: 'toPath matches an exclusion pattern' };
    }

    if (toPath === asset.originalPath) {
      return;
    }

    const stat = await this.storageRepository.stat(toPath).catch(() => null);
    if (!stat?.isFile()) {
      return { code: LibraryAssetMoveError.NotOnDisk, message: 'toPath does not exist on disk' };
    }

    const checksum = this.cryptoRepository.hashSha1(`path:${toPath}`);
    const occupant = await this.assetRepository.getByChecksum({
      ownerId: asset.ownerId,
      libraryId: library.id,
      checksum,
    });
    if (occupant && !occupant.isOffline) {
      return {
        code: LibraryAssetMoveError.Conflict,
        message: `toPath is already used by asset ${occupant.id}`,
      };
    }

    const removed = await this.libraryRepository.moveAsset(
      asset.id,
      {
        originalPath: toPath,
        originalFileName: parse(toPath).base,
        checksum,
        isOffline: false,
        // an asset that went offline by itself returns from the trash, one trashed by a user stays there
        ...(asset.isOffline && asset.status === AssetStatus.Active ? { deletedAt: null } : {}),
      },
      occupant?.id,
    );

    if (occupant) {
      this.logger.debug(`Removed offline asset ${occupant.id} that occupied ${toPath} in library ${library.id}`);
      filesToDelete.push(...removed);
    }

    movedIds.push(asset.id);
  }

  /**
   * Q Space: checks only the existing assets below the given paths. The library wide check of import paths and
   * exclusion patterns (detectOfflineExternalAssets) is skipped: it does not depend on the signalled paths.
   */
  private async queueSyncAssetsForPaths(
    library: { id: string; importPaths: string[]; exclusionPatterns: string[] },
    paths: string[],
  ): Promise<JobStatus> {
    const assetIds: string[] = [];
    for await (const asset of this.libraryRepository.streamAssetIds(library.id, paths)) {
      assetIds.push(asset.id);
    }

    for (let i = 0; i < assetIds.length; i += JOBS_LIBRARY_PAGINATION_SIZE) {
      const chunk = assetIds.slice(i, i + JOBS_LIBRARY_PAGINATION_SIZE);
      await this.jobRepository.queue({
        name: JobName.LibrarySyncAssets,
        data: {
          libraryId: library.id,
          importPaths: library.importPaths,
          exclusionPatterns: library.exclusionPatterns,
          assetIds: chunk,
          progressCounter: i + chunk.length,
          totalAssets: assetIds.length,
        },
      });
    }

    this.logger.log(
      `Queued check of ${assetIds.length} existing asset(s) below ${paths.length} path(s) in library ${library.id}`,
    );

    return JobStatus.Success;
  }

  private async findOrFail(id: string) {
    const library = await this.libraryRepository.get(id);
    if (!library) {
      throw new BadRequestException('Library not found');
    }
    return library;
  }
}

/** `path.normalize` without the trailing separator, the same form that the crawler stores in `originalPath` */
const normalizePath = (value: string) => {
  const normalized = path.normalize(value);
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
};

/** `child` equals `parent` or lies below it */
const isInside = (child: string, parent: string) => {
  const normalizedParent = normalizePath(parent);
  if (child === normalizedParent) {
    return true;
  }
  return child.startsWith(normalizedParent.endsWith('/') ? normalizedParent : `${normalizedParent}/`);
};

const isInsideAny = (child: string, parents: string[]) => parents.some((parent) => isInside(child, parent));
