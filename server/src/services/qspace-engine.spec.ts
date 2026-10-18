import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Stats } from 'node:fs';
import { JOBS_LIBRARY_PAGINATION_SIZE } from 'src/constants';
import { LibraryAssetMoveError } from 'src/dtos/library.dto';
import { AssetFileType, AssetStatus, JobName, JobStatus } from 'src/enum';
import { AssetService } from 'src/services/asset.service';
import { LibraryService } from 'src/services/library.service';
import { MetadataService } from 'src/services/metadata.service';
import { AssetFactory } from 'test/factories/asset.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { getForAssetDeletion, getForSidecarWrite } from 'test/mappers';
import { factory, newUuid } from 'test/small.factory';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';

// Q Space: Immich runs as an engine over folders that are owned by the sync agent (mounted read-only).
// See docs/QSPACE-ENGINE.md.

const fileStat = { isFile: () => true, isDirectory: () => false } as Stats;
const dirStat = { isFile: () => false, isDirectory: () => true } as Stats;

describe('Q Space engine', () => {
  describe(AssetService.name, () => {
    let sut: AssetService;
    let mocks: ServiceMocks;

    beforeEach(() => {
      ({ sut, mocks } = newTestService(AssetService));
    });

    describe('handleAssetDeletion', () => {
      it('should keep an external asset with its file on disk as a tombstone', async () => {
        const asset = AssetFactory.from({ isExternal: true, libraryId: newUuid() })
          .file({ type: AssetFileType.Thumbnail })
          .file({ type: AssetFileType.Preview })
          .file({ type: AssetFileType.Sidecar })
          .build();
        mocks.assetJob.getForAssetDeletion.mockResolvedValue(getForAssetDeletion(asset));

        await expect(sut.handleAssetDeletion({ id: asset.id, deleteOnDisk: true })).resolves.toBe(JobStatus.Success);

        expect(mocks.library.tombstoneAsset).toHaveBeenCalledWith(asset.id);
        expect(mocks.asset.remove).not.toHaveBeenCalled();
        const [thumbnail, preview] = asset.files;
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.FileDelete,
          data: { files: [thumbnail.path, preview.path] },
        });
        const deleted = mocks.job.queue.mock.calls.flatMap(([job]) =>
          job.name === JobName.FileDelete ? job.data.files : [],
        );
        expect(deleted).not.toContain(asset.originalPath);
      });

      it('should remove an offline external asset without touching the original', async () => {
        const asset = AssetFactory.from({ isExternal: true, isOffline: true, libraryId: newUuid() })
          .file({ type: AssetFileType.Thumbnail })
          .build();
        mocks.assetJob.getForAssetDeletion.mockResolvedValue(getForAssetDeletion(asset));

        await sut.handleAssetDeletion({ id: asset.id, deleteOnDisk: true });

        expect(mocks.library.tombstoneAsset).not.toHaveBeenCalled();
        expect(mocks.asset.remove).toHaveBeenCalled();
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.FileDelete,
          data: { files: [asset.files[0].path] },
        });
      });

      it('should remove the row of an external asset when the library is deleted', async () => {
        const asset = AssetFactory.from({ isExternal: true, libraryId: newUuid() }).build();
        mocks.assetJob.getForAssetDeletion.mockResolvedValue(getForAssetDeletion(asset));

        await sut.handleAssetDeletion({ id: asset.id, deleteOnDisk: false });

        expect(mocks.library.tombstoneAsset).not.toHaveBeenCalled();
        expect(mocks.asset.remove).toHaveBeenCalled();
        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FileDelete, data: { files: [] } });
      });

      it('should keep the motion part of a tombstoned live photo', async () => {
        const asset = AssetFactory.create({ isExternal: true, libraryId: newUuid(), livePhotoVideoId: newUuid() });
        mocks.assetJob.getForAssetDeletion.mockResolvedValue(getForAssetDeletion(asset));
        mocks.asset.getLivePhotoCount.mockResolvedValue(0);

        await sut.handleAssetDeletion({ id: asset.id, deleteOnDisk: true });

        expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.AssetDelete }));
      });

      it('should still delete the original of an uploaded asset', async () => {
        const asset = AssetFactory.from().file({ type: AssetFileType.Sidecar }).build();
        mocks.assetJob.getForAssetDeletion.mockResolvedValue(getForAssetDeletion(asset));

        await sut.handleAssetDeletion({ id: asset.id, deleteOnDisk: true });

        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.FileDelete,
          data: { files: [asset.files[0].path, asset.originalPath] },
        });
      });
    });
  });

  describe(MetadataService.name, () => {
    let sut: MetadataService;
    let mocks: ServiceMocks;

    beforeEach(() => {
      ({ sut, mocks } = newTestService(MetadataService));
    });

    it('should not write a sidecar for an external asset and keep the edited properties locked', async () => {
      const asset = AssetFactory.from({ isExternal: true, libraryId: newUuid() })
        .exif({ description: 'edited in the hub', rating: 4 })
        .build();
      mocks.assetJob.getForSidecarWriteJob.mockResolvedValue(getForSidecarWrite(asset));
      mocks.assetJob.getLockedPropertiesForMetadataExtraction.mockResolvedValue(['description', 'rating']);

      await expect(sut.handleSidecarWrite({ id: asset.id })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.metadata.writeTags).not.toHaveBeenCalled();
      expect(mocks.asset.upsertFile).not.toHaveBeenCalled();
      expect(mocks.asset.unlockProperties).not.toHaveBeenCalled();
    });
  });

  describe(LibraryService.name, () => {
    let sut: LibraryService;
    let mocks: ServiceMocks;

    beforeEach(() => {
      ({ sut, mocks } = newTestService(LibraryService));
    });

    describe('queueScan with paths', () => {
      it('should queue a partial scan of normalized paths inside the import paths', async () => {
        const library = factory.library({ importPaths: ['/mnt/agent'] });
        mocks.library.get.mockResolvedValue(library);

        await sut.queueScan(library.id, {
          paths: ['/mnt/agent/Фото 2025/', '/mnt/agent/Фото 2025/June', '/mnt/agent/b'],
        });

        const paths = ['/mnt/agent/b', '/mnt/agent/Фото 2025'];
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.LibrarySyncFilesQueueAll,
          data: { id: library.id, paths },
        });
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.LibrarySyncAssetsQueueAll,
          data: { id: library.id, paths },
        });
      });

      it('should reject paths outside of the import paths', async () => {
        const library = factory.library({ importPaths: ['/mnt/agent'] });
        mocks.library.get.mockResolvedValue(library);

        await expect(sut.queueScan(library.id, { paths: ['/mnt/agent-other/x'] })).rejects.toBeInstanceOf(
          BadRequestException,
        );
        await expect(sut.queueScan(library.id, { paths: ['/mnt/agent/../etc'] })).rejects.toBeInstanceOf(
          BadRequestException,
        );
        await expect(sut.queueScan(library.id, { paths: ['relative/path'] })).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(mocks.job.queue).not.toHaveBeenCalled();
      });
    });

    describe('handleQueueSyncFiles with paths', () => {
      it('should only crawl the given folders and import single files', async () => {
        const library = factory.library({ importPaths: ['/mnt/agent'], exclusionPatterns: ['**/.qspace/**'] });
        mocks.library.get.mockResolvedValue(library);
        mocks.storage.checkFileExists.mockResolvedValue(true);
        mocks.storage.stat.mockImplementation((path) => {
          if (path === '/mnt/agent' || path === '/mnt/agent/folder') {
            return Promise.resolve(dirStat);
          }
          if (path === '/mnt/agent/single.jpg') {
            return Promise.resolve(fileStat);
          }
          return Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        });
        mocks.storage.walk.mockImplementation(async function* () {
          yield await Promise.resolve(['/mnt/agent/folder/a.jpg']);
        });
        mocks.asset.filterNewExternalAssetPaths.mockImplementation((_, paths) => Promise.resolve(paths));

        await sut.handleQueueSyncFiles({
          id: library.id,
          paths: ['/mnt/agent/folder', '/mnt/agent/single.jpg', '/mnt/agent/gone'],
        });

        expect(mocks.storage.walk).toHaveBeenCalledWith({
          pathsToCrawl: ['/mnt/agent/folder'],
          includeHidden: false,
          exclusionPatterns: library.exclusionPatterns,
          take: JOBS_LIBRARY_PAGINATION_SIZE,
        });
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.LibrarySyncFiles,
          data: { libraryId: library.id, paths: ['/mnt/agent/single.jpg'], progressCounter: 1 },
        });
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.LibrarySyncFiles,
          data: { libraryId: library.id, paths: ['/mnt/agent/folder/a.jpg'], progressCounter: 2 },
        });
        expect(mocks.library.update).not.toHaveBeenCalled();
      });

      it('should not import a single file that is excluded or hidden', async () => {
        const library = factory.library({ importPaths: ['/mnt/agent'], exclusionPatterns: ['**/.qspace/**'] });
        mocks.library.get.mockResolvedValue(library);
        mocks.storage.checkFileExists.mockResolvedValue(true);
        mocks.storage.stat.mockImplementation((path) => Promise.resolve(path === '/mnt/agent' ? dirStat : fileStat));
        mocks.storage.walk.mockImplementation(async function* () {});

        await sut.handleQueueSyncFiles({
          id: library.id,
          paths: ['/mnt/agent/.qspace/x.jpg', '/mnt/agent/a/.hidden.jpg', '/mnt/agent/notes.txt'],
        });

        expect(mocks.asset.filterNewExternalAssetPaths).not.toHaveBeenCalled();
        expect(mocks.job.queue).not.toHaveBeenCalled();
      });
    });

    describe('handleQueueSyncAssets with paths', () => {
      it('should only check the assets below the paths and skip the library wide offline check', async () => {
        const library = factory.library({ importPaths: ['/mnt/agent'] });
        const asset = AssetFactory.create({ libraryId: library.id, isExternal: true });
        mocks.library.get.mockResolvedValue(library);
        mocks.library.streamAssetIds.mockReturnValue(makeStream([asset]));

        await expect(sut.handleQueueSyncAssets({ id: library.id, paths: ['/mnt/agent/folder'] })).resolves.toBe(
          JobStatus.Success,
        );

        expect(mocks.library.streamAssetIds).toHaveBeenCalledWith(library.id, ['/mnt/agent/folder']);
        expect(mocks.asset.detectOfflineExternalAssets).not.toHaveBeenCalled();
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.LibrarySyncAssets,
          data: {
            libraryId: library.id,
            importPaths: library.importPaths,
            exclusionPatterns: library.exclusionPatterns,
            assetIds: [asset.id],
            progressCounter: 1,
            totalAssets: 1,
          },
        });
      });
    });

    describe('handleSyncAssets', () => {
      it('should not re-process a tombstone whose file changed', async () => {
        const asset = AssetFactory.create({
          isExternal: true,
          status: AssetStatus.Deleted,
          deletedAt: new Date(),
          fileModifiedAt: new Date('2020-01-01'),
        });
        mocks.assetJob.getForSyncAssets.mockResolvedValue([asset]);
        mocks.storage.stat.mockResolvedValue({ mtime: new Date('2024-01-01') } as Stats);

        await sut.handleSyncAssets({
          libraryId: newUuid(),
          importPaths: ['/'],
          exclusionPatterns: [],
          assetIds: [asset.id],
          progressCounter: 1,
          totalAssets: 1,
        });

        expect(mocks.job.queueAll).not.toHaveBeenCalled();
        expect(mocks.asset.updateAll).not.toHaveBeenCalled();
      });
    });

    describe('moveAssets', () => {
      const library = factory.library({ importPaths: ['/mnt/agent'], exclusionPatterns: ['**/.qspace/**'] });
      const assetForMove = (overrides: Record<string, unknown> = {}) => ({
        id: newUuid(),
        ownerId: library.ownerId,
        libraryId: library.id,
        originalPath: '/mnt/agent/old/a.jpg',
        isOffline: false,
        isExternal: true,
        status: AssetStatus.Active,
        deletedAt: null,
        ...overrides,
      });

      beforeEach(() => {
        mocks.library.get.mockResolvedValue(library);
        mocks.storage.stat.mockResolvedValue(fileStat);
        mocks.library.moveAsset.mockResolvedValue([]);
      });

      it('should require an admin or the library owner', async () => {
        await expect(
          sut.moveAssets(authStub.user1, library.id, {
            items: [{ fromPath: '/mnt/agent/a.jpg', toPath: '/mnt/agent/b.jpg' }],
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('should allow the owner of the library', async () => {
        mocks.library.get.mockResolvedValue({ ...library, ownerId: authStub.user1.user.id });
        mocks.library.getAssetForMove.mockResolvedValue(void 0);

        await expect(
          sut.moveAssets(authStub.user1, library.id, {
            items: [{ fromPath: '/mnt/agent/a.jpg', toPath: '/mnt/agent/b.jpg' }],
          }),
        ).resolves.toEqual(expect.objectContaining({ moved: 0, failed: 1 }));
      });

      it('should update path, file name and checksum and keep the id', async () => {
        const asset = assetForMove();
        mocks.library.getAssetForMove.mockResolvedValue(asset);
        mocks.asset.getByChecksum.mockResolvedValue(void 0);

        const result = await sut.moveAssets(authStub.admin, library.id, {
          items: [{ fromPath: '/mnt/agent/old/a.jpg', toPath: '/mnt/agent/new/b.jpg' }],
        });

        expect(result).toEqual({
          moved: 1,
          failed: 0,
          items: [{ assetId: asset.id, fromPath: asset.originalPath, toPath: '/mnt/agent/new/b.jpg', success: true }],
        });
        expect(mocks.library.getAssetForMove).toHaveBeenCalledWith(library.id, {
          id: undefined,
          originalPath: '/mnt/agent/old/a.jpg',
        });
        expect(mocks.library.moveAsset).toHaveBeenCalledWith(
          asset.id,
          {
            originalPath: '/mnt/agent/new/b.jpg',
            originalFileName: 'b.jpg',
            checksum: Buffer.from('path:/mnt/agent/new/b.jpg (hashed)'),
            isOffline: false,
          },
          undefined,
        );
        expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.SidecarCheck, data: { id: asset.id } }]);
      });

      it('should bring an offline asset back from the trash, but keep a user trashed asset in it', async () => {
        const offline = assetForMove({ isOffline: true, deletedAt: new Date() });
        const trashed = assetForMove({ isOffline: true, status: AssetStatus.Trashed, deletedAt: new Date() });
        mocks.library.getAssetForMove.mockResolvedValueOnce(offline).mockResolvedValueOnce(trashed);

        await sut.moveAssets(authStub.admin, library.id, {
          items: [
            { assetId: offline.id, toPath: '/mnt/agent/x.jpg' },
            { assetId: trashed.id, toPath: '/mnt/agent/y.jpg' },
          ],
        });

        expect(mocks.library.moveAsset).toHaveBeenNthCalledWith(
          1,
          offline.id,
          expect.objectContaining({ isOffline: false, deletedAt: null }),
          void 0,
        );
        expect(mocks.library.moveAsset.mock.calls[1][1]).not.toHaveProperty('deletedAt');
      });

      it('should report per item errors and still move the other items', async () => {
        const asset = assetForMove();
        const occupied = assetForMove({ originalPath: '/mnt/agent/c.jpg' });
        mocks.library.getAssetForMove.mockImplementation((_, { id }) =>
          Promise.resolve([asset, occupied].find((item) => item.id === id)),
        );
        mocks.asset.getByChecksum.mockImplementation(({ checksum }) =>
          Promise.resolve(
            checksum.toString() === 'path:/mnt/agent/taken.jpg (hashed)'
              ? (AssetFactory.create({ isOffline: false }) as any)
              : undefined,
          ),
        );
        mocks.storage.stat.mockImplementation((path) =>
          path === '/mnt/agent/missing.jpg' ? Promise.reject(new Error('ENOENT')) : Promise.resolve(fileStat),
        );

        const result = await sut.moveAssets(authStub.admin, library.id, {
          items: [
            { assetId: newUuid(), toPath: '/mnt/agent/z.jpg' },
            { assetId: asset.id, toPath: '/elsewhere/z.jpg' },
            { assetId: asset.id, toPath: '/mnt/agent/.qspace/z.jpg' },
            { assetId: asset.id, toPath: '/mnt/agent/z.txt' },
            { assetId: asset.id, toPath: '/mnt/agent/missing.jpg' },
            { assetId: occupied.id, toPath: '/mnt/agent/taken.jpg' },
            { assetId: asset.id, toPath: '/mnt/agent/ok.jpg' },
          ],
        });

        expect(result.moved).toBe(1);
        expect(result.failed).toBe(6);
        expect(result.items.map(({ error }) => error)).toEqual([
          LibraryAssetMoveError.NotFound,
          LibraryAssetMoveError.InvalidPath,
          LibraryAssetMoveError.InvalidPath,
          LibraryAssetMoveError.InvalidPath,
          LibraryAssetMoveError.NotOnDisk,
          LibraryAssetMoveError.Conflict,
          undefined,
        ]);
        expect(mocks.library.moveAsset).toHaveBeenCalledTimes(1);
      });

      it('should replace an offline asset that occupies the target path', async () => {
        const asset = assetForMove();
        const occupant = AssetFactory.create({ isOffline: true });
        mocks.library.getAssetForMove.mockResolvedValue(asset);
        mocks.asset.getByChecksum.mockResolvedValue(occupant as any);
        mocks.library.moveAsset.mockResolvedValue(['/data/thumbs/occupant.webp']);

        const result = await sut.moveAssets(authStub.admin, library.id, {
          items: [{ assetId: asset.id, toPath: '/mnt/agent/b.jpg' }],
        });

        expect(result.moved).toBe(1);
        expect(mocks.library.moveAsset).toHaveBeenCalledWith(asset.id, expect.any(Object), occupant.id);
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.FileDelete,
          data: { files: ['/data/thumbs/occupant.webp'] },
        });
      });

      it('should replace a tombstone that occupies the target path', async () => {
        const asset = assetForMove();
        const tombstone = AssetFactory.create({ isOffline: false, status: AssetStatus.Deleted });
        mocks.library.getAssetForMove.mockResolvedValue(asset);
        mocks.asset.getByChecksum.mockResolvedValue(tombstone as any);

        const result = await sut.moveAssets(authStub.admin, library.id, {
          items: [{ assetId: asset.id, toPath: '/mnt/agent/b.jpg' }],
        });

        expect(result.moved).toBe(1);
        expect(mocks.library.moveAsset).toHaveBeenCalledWith(asset.id, expect.any(Object), tombstone.id);
      });

      it('should move every asset below a folder prefix', async () => {
        const a = assetForMove({ originalPath: '/mnt/agent/old/a.jpg' });
        const b = assetForMove({ originalPath: '/mnt/agent/old/sub/b.jpg' });
        mocks.library.getAssetsForMoveByPrefix.mockResolvedValue([a, b]);
        mocks.library.getAssetForMove.mockImplementation((_, { id }) =>
          Promise.resolve([a, b].find((x) => x.id === id)),
        );

        const result = await sut.moveAssets(authStub.admin, library.id, {
          fromPrefix: '/mnt/agent/old/',
          toPrefix: '/mnt/agent/new',
        });

        expect(mocks.library.getAssetsForMoveByPrefix).toHaveBeenCalledWith(library.id, '/mnt/agent/old');
        expect(result.moved).toBe(2);
        expect(result.items.map(({ toPath }) => toPath)).toEqual(['/mnt/agent/new/a.jpg', '/mnt/agent/new/sub/b.jpg']);
      });

      it('should reject a prefix outside of the import paths', async () => {
        await expect(
          sut.moveAssets(authStub.admin, library.id, { fromPrefix: '/mnt/agent/old', toPrefix: '/tmp/new' }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });
  });
});
