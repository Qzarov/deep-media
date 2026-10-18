import { Kysely } from 'kysely';
import { Stats } from 'node:fs';
import { AssetFileType, AssetStatus, JobName } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LibraryRepository } from 'src/repositories/library.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedLinkAssetRepository } from 'src/repositories/shared-link-asset.repository';
import { StackRepository } from 'src/repositories/stack.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { TrashRepository } from 'src/repositories/trash.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { AssetService } from 'src/services/asset.service';
import { LibraryService } from 'src/services/library.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';
import { Mocked } from 'vitest';

// Q Space: Immich as an engine over folders owned by the sync agent. See docs/QSPACE-ENGINE.md.

let defaultDatabase: Kysely<DB>;

const setupAssetService = () => {
  const result = newMediumService(AssetService, {
    database: defaultDatabase,
    real: [
      AssetRepository,
      AssetJobRepository,
      AlbumRepository,
      AccessRepository,
      LibraryRepository,
      SharedLinkAssetRepository,
      StackRepository,
      UserRepository,
    ],
    mock: [EventRepository, LoggingRepository, JobRepository, StorageRepository],
  });
  result.ctx.getMock(EventRepository).emit.mockResolvedValue();
  mockJobs(result.ctx.getMock(JobRepository));
  return result;
};

const setupLibraryService = () => {
  const result = newMediumService(LibraryService, {
    database: defaultDatabase,
    real: [AssetRepository, AssetJobRepository, LibraryRepository, CryptoRepository],
    mock: [LoggingRepository, JobRepository, StorageRepository],
  });
  mockJobs(result.ctx.getMock(JobRepository));
  return result;
};

const mockJobs = (job: Mocked<JobRepository>) => {
  job.queue.mockResolvedValue();
  job.queueAll.mockResolvedValue();
};

const sha1Path = (path: string) => new CryptoRepository().hashSha1(`path:${path}`);

const newLibrary = async (
  ctx: { get: <T>(key: new (...args: any[]) => T) => T },
  ownerId: string,
  importPaths = ['/mnt/agent'],
) => ctx.get(LibraryRepository).create({ ownerId, name: 'agent', importPaths, exclusionPatterns: [] });

const newExternalAsset = async (
  ctx: ReturnType<typeof setupLibraryService>['ctx'] | ReturnType<typeof setupAssetService>['ctx'],
  { ownerId, libraryId, path, ...dto }: { ownerId: string; libraryId: string; path: string } & Record<string, any>,
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    libraryId,
    isExternal: true,
    originalPath: path,
    originalFileName: path.split('/').at(-1),
    checksum: sha1Path(path),
    ...dto,
  });
  return asset;
};

describe('Q Space engine (medium)', () => {
  beforeAll(async () => {
    defaultDatabase = await getKyselyDB();
  });

  describe('tombstone', () => {
    it('should keep the row and id of a deleted external asset whose file is on disk', async () => {
      const { sut, ctx } = setupAssetService();
      const { user } = await ctx.newUser();
      const library = await newLibrary(ctx, user.id);
      const path = '/mnt/agent/Фото 2025/IMG_0008.jpg';
      const asset = await newExternalAsset(ctx, {
        ownerId: user.id,
        libraryId: library.id,
        path,
        status: AssetStatus.Deleted,
        deletedAt: new Date(),
      });
      await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Thumbnail, path: '/data/thumbs/x.webp' });
      await ctx.newAssetFace({ assetId: asset.id });

      await sut.handleAssetDeletion({ id: asset.id, deleteOnDisk: true });

      const row = await defaultDatabase
        .selectFrom('asset')
        .select(['id', 'status', 'deletedAt'])
        .where('id', '=', asset.id)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe(AssetStatus.Deleted);
      expect(row.deletedAt).not.toBeNull();
      await expect(
        defaultDatabase.selectFrom('asset_file').select('id').where('assetId', '=', asset.id).execute(),
      ).resolves.toEqual([]);
      await expect(
        defaultDatabase.selectFrom('asset_face').select('id').where('assetId', '=', asset.id).execute(),
      ).resolves.toEqual([]);

      const fileDelete = ctx.getMock(JobRepository).queue.mock.calls.find(([job]) => job.name === JobName.FileDelete);
      expect(fileDelete?.[0]).toEqual({ name: JobName.FileDelete, data: { files: ['/data/thumbs/x.webp'] } });

      // the next scan must not import the file again with a new id
      await expect(ctx.get(AssetRepository).filterNewExternalAssetPaths(library.id, [path])).resolves.toEqual([]);

      // and the tombstone is not queued for deletion again
      const future = new Date(Date.now() + 86_400_000);
      const deletedJob: string[] = [];
      for await (const { id } of ctx.get(AssetJobRepository).streamForDeletedJob(future)) {
        deletedJob.push(id);
      }
      expect(deletedJob).not.toContain(asset.id);

      const emptyTrash: string[] = [];
      for await (const { id } of ctx.get(TrashRepository).getDeletedIds()) {
        emptyTrash.push(id);
      }
      expect(emptyTrash).not.toContain(asset.id);
    });

    it('should still queue a deleted external asset that has generated files', async () => {
      const { ctx } = setupAssetService();
      const { user } = await ctx.newUser();
      const library = await newLibrary(ctx, user.id);
      const asset = await newExternalAsset(ctx, {
        ownerId: user.id,
        libraryId: library.id,
        path: '/mnt/agent/a.jpg',
        status: AssetStatus.Deleted,
        deletedAt: new Date(),
      });
      await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Thumbnail, path: '/data/thumbs/a.webp' });

      const ids: string[] = [];
      for await (const { id } of ctx.get(TrashRepository).getDeletedIds()) {
        ids.push(id);
      }
      expect(ids).toContain(asset.id);
    });
  });

  describe('copy', () => {
    it('should not unlink or create a sidecar next to an external original', async () => {
      const { sut, ctx } = setupAssetService();
      const { user } = await ctx.newUser();
      const library = await newLibrary(ctx, user.id);
      const { asset: source } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newAssetFile({ assetId: source.id, type: AssetFileType.Sidecar, path: '/data/upload/source.jpg.xmp' });
      const target = await newExternalAsset(ctx, { ownerId: user.id, libraryId: library.id, path: '/mnt/agent/t.jpg' });
      await ctx.newAssetFile({ assetId: target.id, type: AssetFileType.Sidecar, path: '/mnt/agent/t.jpg.xmp' });
      const storage = ctx.getMock(StorageRepository);

      await sut.copy(factory.auth({ user: { id: user.id } }), { sourceId: source.id, targetId: target.id });

      expect(storage.unlink).not.toHaveBeenCalled();
      expect(storage.copyFile).not.toHaveBeenCalled();
      await expect(
        defaultDatabase.selectFrom('asset_file').select('path').where('assetId', '=', target.id).execute(),
      ).resolves.toEqual([{ path: '/mnt/agent/t.jpg.xmp' }]);
    });
  });

  describe('scan by paths', () => {
    it('should only stream assets below the paths, respecting separators and literal wildcards', async () => {
      const { ctx } = setupLibraryService();
      const { user } = await ctx.newUser();
      const library = await newLibrary(ctx, user.id);
      const paths = [
        '/mnt/agent/a_b/1.jpg',
        '/mnt/agent/a_b/sub/2.jpg',
        '/mnt/agent/axb/3.jpg',
        '/mnt/agent/a_bc/4.jpg',
        '/mnt/agent/single.jpg',
      ];
      const assets = [];
      for (const path of paths) {
        assets.push(await newExternalAsset(ctx, { ownerId: user.id, libraryId: library.id, path }));
      }

      const ids: string[] = [];
      for await (const { id } of ctx
        .get(LibraryRepository)
        .streamAssetIds(library.id, ['/mnt/agent/a_b', '/mnt/agent/single.jpg'])) {
        ids.push(id);
      }

      expect(ids.sort()).toEqual([assets[0].id, assets[1].id, assets[4].id].sort());
    });

    it('should offline the assets of a removed folder only', async () => {
      const { sut, ctx } = setupLibraryService();
      const { user } = await ctx.newUser();
      const library = await newLibrary(ctx, user.id);
      const gone = await newExternalAsset(ctx, {
        ownerId: user.id,
        libraryId: library.id,
        path: '/mnt/agent/gone/1.jpg',
      });
      const kept = await newExternalAsset(ctx, {
        ownerId: user.id,
        libraryId: library.id,
        path: '/mnt/agent/kept/2.jpg',
      });
      const job = ctx.getMock(JobRepository);
      ctx.getMock(StorageRepository).stat.mockRejectedValue(new Error('ENOENT'));

      await sut.handleQueueSyncAssets({ id: library.id, paths: ['/mnt/agent/gone'] });
      const [[{ data }]] = job.queue.mock.calls as any;
      expect(data.assetIds).toEqual([gone.id]);

      await sut.handleSyncAssets(data);

      const rows = await defaultDatabase
        .selectFrom('asset')
        .select(['id', 'isOffline'])
        .where('id', 'in', [gone.id, kept.id])
        .execute();
      expect(Object.fromEntries(rows.map(({ id, isOffline }) => [id, isOffline]))).toEqual({
        [gone.id]: true,
        [kept.id]: false,
      });
    });
  });

  describe('move', () => {
    it('should keep the id, faces and favorite and update path, name and checksum', async () => {
      const { sut, ctx } = setupLibraryService();
      const { user } = await ctx.newUser({ isAdmin: true });
      const library = await newLibrary(ctx, user.id);
      const asset = await newExternalAsset(ctx, {
        ownerId: user.id,
        libraryId: library.id,
        path: '/mnt/agent/old/a.jpg',
        isFavorite: true,
      });
      await ctx.newAssetFace({ assetId: asset.id });
      ctx.getMock(StorageRepository).stat.mockResolvedValue({ isFile: () => true } as Stats);

      const auth = factory.auth({ user: { id: user.id, isAdmin: true } });
      const result = await sut.moveAssets(auth, library.id, {
        items: [{ fromPath: '/mnt/agent/old/a.jpg', toPath: '/mnt/agent/new/b.jpg' }],
      });

      expect(result).toEqual(expect.objectContaining({ moved: 1, failed: 0 }));
      const row = await defaultDatabase
        .selectFrom('asset')
        .select(['originalPath', 'originalFileName', 'checksum', 'isFavorite'])
        .where('id', '=', asset.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({
        originalPath: '/mnt/agent/new/b.jpg',
        originalFileName: 'b.jpg',
        checksum: sha1Path('/mnt/agent/new/b.jpg'),
        isFavorite: true,
      });
      await expect(
        defaultDatabase.selectFrom('asset_face').select('id').where('assetId', '=', asset.id).execute(),
      ).resolves.toHaveLength(1);
      await expect(
        ctx.get(AssetRepository).filterNewExternalAssetPaths(library.id, ['/mnt/agent/new/b.jpg']),
      ).resolves.toEqual([]);
    });

    it('should replace an offline occupant and refuse an online one', async () => {
      const { sut, ctx } = setupLibraryService();
      const { user } = await ctx.newUser({ isAdmin: true });
      const library = await newLibrary(ctx, user.id);
      const a = await newExternalAsset(ctx, { ownerId: user.id, libraryId: library.id, path: '/mnt/agent/a.jpg' });
      const b = await newExternalAsset(ctx, { ownerId: user.id, libraryId: library.id, path: '/mnt/agent/b.jpg' });
      const offline = await newExternalAsset(ctx, {
        ownerId: user.id,
        libraryId: library.id,
        path: '/mnt/agent/c.jpg',
        isOffline: true,
        deletedAt: new Date(),
      });
      ctx.getMock(StorageRepository).stat.mockResolvedValue({ isFile: () => true } as Stats);

      const auth = factory.auth({ user: { id: user.id, isAdmin: true } });
      const result = await sut.moveAssets(auth, library.id, {
        items: [
          { assetId: a.id, toPath: '/mnt/agent/b.jpg' },
          { assetId: b.id, toPath: '/mnt/agent/c.jpg' },
        ],
      });

      expect(result.items.map(({ success, error }) => ({ success, error }))).toEqual([
        { success: false, error: 'conflict' },
        { success: true, error: undefined },
      ]);
      const ids = await defaultDatabase
        .selectFrom('asset')
        .select(['id', 'originalPath'])
        .where('libraryId', '=', library.id)
        .orderBy('originalPath')
        .execute();
      expect(ids).toEqual([
        { id: a.id, originalPath: '/mnt/agent/a.jpg' },
        { id: b.id, originalPath: '/mnt/agent/c.jpg' },
      ]);
      expect(ids.map(({ id }) => id)).not.toContain(offline.id);
    });

    it('should move a folder by prefix', async () => {
      const { sut, ctx } = setupLibraryService();
      const { user } = await ctx.newUser({ isAdmin: true });
      const library = await newLibrary(ctx, user.id);
      const a = await newExternalAsset(ctx, { ownerId: user.id, libraryId: library.id, path: '/mnt/agent/2025/a.jpg' });
      const b = await newExternalAsset(ctx, {
        ownerId: user.id,
        libraryId: library.id,
        path: '/mnt/agent/2025/x/b.jpg',
      });
      const other = await newExternalAsset(ctx, {
        ownerId: user.id,
        libraryId: library.id,
        path: '/mnt/agent/2025b/c.jpg',
      });
      ctx.getMock(StorageRepository).stat.mockResolvedValue({ isFile: () => true } as Stats);

      const auth = factory.auth({ user: { id: user.id, isAdmin: true } });
      const result = await sut.moveAssets(auth, library.id, {
        fromPrefix: '/mnt/agent/2025',
        toPrefix: '/mnt/agent/Архив/2025',
      });

      expect(result.moved).toBe(2);
      const rows = await defaultDatabase
        .selectFrom('asset')
        .select(['id', 'originalPath'])
        .where('id', 'in', [a.id, b.id, other.id])
        .execute();
      expect(Object.fromEntries(rows.map(({ id, originalPath }) => [id, originalPath]))).toEqual({
        [a.id]: '/mnt/agent/Архив/2025/a.jpg',
        [b.id]: '/mnt/agent/Архив/2025/x/b.jpg',
        [other.id]: '/mnt/agent/2025b/c.jpg',
      });
    });
  });
});
