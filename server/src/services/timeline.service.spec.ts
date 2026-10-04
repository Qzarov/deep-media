import { BadRequestException } from '@nestjs/common';
import { AssetVisibility } from 'src/enum';
import { TimelineService } from 'src/services/timeline.service';
import { AuthFactory } from 'test/factories/auth.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { newTestService, ServiceMocks } from 'test/utils';

describe(TimelineService.name, () => {
  let sut: TimelineService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(TimelineService));
  });

  describe('getTimeBuckets', () => {
    it("should return buckets if userId and albumId aren't set", async () => {
      mocks.asset.getTimeBuckets.mockResolvedValue([{ timeBucket: 'bucket', count: 1 }]);

      await expect(sut.getTimeBuckets(authStub.admin, {})).resolves.toEqual(
        expect.arrayContaining([{ timeBucket: 'bucket', count: 1 }]),
      );
      expect(mocks.asset.getTimeBuckets).toHaveBeenCalledWith({
        userIds: [authStub.admin.user.id],
        excludeLockedAlbums: true,
      });
    });

    it('should pass bbox options to repository when all bbox fields are provided', async () => {
      mocks.asset.getTimeBuckets.mockResolvedValue([{ timeBucket: 'bucket', count: 1 }]);

      await sut.getTimeBuckets(authStub.admin, {
        bbox: {
          west: -70,
          south: -30,
          east: 120,
          north: 55,
        },
      });

      expect(mocks.asset.getTimeBuckets).toHaveBeenCalledWith({
        userIds: [authStub.admin.user.id],
        bbox: { west: -70, south: -30, east: 120, north: 55 },
        excludeLockedAlbums: true,
      });
    });

    it('should not hide locked-album assets inside the locked album itself', async () => {
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-id']));
      mocks.access.album.getLocked.mockResolvedValue(new Set(['album-id']));
      mocks.asset.getTimeBuckets.mockResolvedValue([]);
      const unlocked = AuthFactory.from().session({ hasElevatedPermission: true }).build();

      await sut.getTimeBuckets(unlocked, { albumId: 'album-id' });

      expect(mocks.asset.getTimeBuckets).toHaveBeenCalledWith(
        expect.objectContaining({ albumId: 'album-id', excludeLockedAlbums: false }),
      );
    });

    it('should hide assets shared with a locked album inside a normal album', async () => {
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-id']));
      mocks.asset.getTimeBuckets.mockResolvedValue([]);

      await sut.getTimeBuckets(authStub.admin, { albumId: 'album-id' });

      expect(mocks.asset.getTimeBuckets).toHaveBeenCalledWith(
        expect.objectContaining({ albumId: 'album-id', excludeLockedAlbums: true }),
      );
    });

    it('should require a PIN-unlocked session to read a locked album', async () => {
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-id']));
      mocks.access.album.getLocked.mockResolvedValue(new Set(['album-id']));

      await expect(sut.getTimeBuckets(authStub.admin, { albumId: 'album-id' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.asset.getTimeBuckets).not.toHaveBeenCalled();
    });

    it('should show locked-album assets in the trash only for a PIN-unlocked session', async () => {
      mocks.asset.getTimeBuckets.mockResolvedValue([]);
      const unlocked = AuthFactory.from().session({ hasElevatedPermission: true }).build();
      const locked = AuthFactory.from().session().build();

      await sut.getTimeBuckets(unlocked, { isTrashed: true });
      await sut.getTimeBuckets(locked, { isTrashed: true });

      expect(mocks.asset.getTimeBuckets).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ excludeLockedAlbums: false }),
      );
      expect(mocks.asset.getTimeBuckets).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ excludeLockedAlbums: true }),
      );
    });
  });

  describe('getTimeBucket', () => {
    it('should return the assets for a album time bucket if user has album.read', async () => {
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-id']));
      const json = `[{ id: ['asset-id'] }]`;
      mocks.asset.getTimeBucket.mockResolvedValue({ assets: json });

      await expect(sut.getTimeBucket(authStub.admin, { timeBucket: 'bucket', albumId: 'album-id' })).resolves.toEqual(
        json,
      );

      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalledWith(authStub.admin.user.id, new Set(['album-id']));
      expect(mocks.asset.getTimeBucket).toHaveBeenCalledWith(
        'bucket',
        {
          timeBucket: 'bucket',
          albumId: 'album-id',
          excludeLockedAlbums: true,
        },
        authStub.admin,
      );
    });

    it('should return the assets for a archive time bucket if user has archive.read', async () => {
      const json = `[{ id: ['asset-id'] }]`;
      mocks.asset.getTimeBucket.mockResolvedValue({ assets: json });

      await expect(
        sut.getTimeBucket(authStub.admin, {
          timeBucket: 'bucket',
          visibility: AssetVisibility.Archive,
          userId: authStub.admin.user.id,
        }),
      ).resolves.toEqual(json);
      expect(mocks.asset.getTimeBucket).toHaveBeenCalledWith(
        'bucket',
        expect.objectContaining({
          timeBucket: 'bucket',
          visibility: AssetVisibility.Archive,
          userIds: [authStub.admin.user.id],
        }),
        authStub.admin,
      );
    });

    it('should include partner shared assets', async () => {
      const json = `[{ id: ['asset-id'] }]`;
      mocks.asset.getTimeBucket.mockResolvedValue({ assets: json });
      mocks.partner.getAll.mockResolvedValue([]);

      await expect(
        sut.getTimeBucket(authStub.admin, {
          timeBucket: 'bucket',
          visibility: AssetVisibility.Timeline,
          userId: authStub.admin.user.id,
          withPartners: true,
        }),
      ).resolves.toEqual(json);
      expect(mocks.asset.getTimeBucket).toHaveBeenCalledWith(
        'bucket',
        {
          timeBucket: 'bucket',
          visibility: AssetVisibility.Timeline,
          withPartners: true,
          userIds: [authStub.admin.user.id],
          excludeLockedAlbums: true,
        },
        authStub.admin,
      );
    });

    it('should check permissions to read tag', async () => {
      const json = `[{ id: ['asset-id'] }]`;
      mocks.asset.getTimeBucket.mockResolvedValue({ assets: json });
      mocks.access.tag.checkOwnerAccess.mockResolvedValue(new Set(['tag-123']));

      await expect(
        sut.getTimeBucket(authStub.admin, {
          timeBucket: 'bucket',
          userId: authStub.admin.user.id,
          tagId: 'tag-123',
        }),
      ).resolves.toEqual(json);
      expect(mocks.asset.getTimeBucket).toHaveBeenCalledWith(
        'bucket',
        {
          tagId: 'tag-123',
          timeBucket: 'bucket',
          userIds: [authStub.admin.user.id],
          excludeLockedAlbums: true,
        },
        authStub.admin,
      );
    });

    it('should return the assets for a library time bucket if user has library.read', async () => {
      const json = `[{ id: ['asset-id'] }]`;
      mocks.asset.getTimeBucket.mockResolvedValue({ assets: json });

      await expect(
        sut.getTimeBucket(authStub.admin, {
          timeBucket: 'bucket',
          userId: authStub.admin.user.id,
        }),
      ).resolves.toEqual(json);
      expect(mocks.asset.getTimeBucket).toHaveBeenCalledWith(
        'bucket',
        expect.objectContaining({
          timeBucket: 'bucket',
          userIds: [authStub.admin.user.id],
        }),
        authStub.admin,
      );
    });

    it('should throw an error if withParners is true and visibility true or undefined', async () => {
      await expect(
        sut.getTimeBucket(authStub.admin, {
          timeBucket: 'bucket',
          visibility: AssetVisibility.Archive,
          withPartners: true,
          userId: authStub.admin.user.id,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        sut.getTimeBucket(authStub.admin, {
          timeBucket: 'bucket',
          visibility: undefined,
          withPartners: true,
          userId: authStub.admin.user.id,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw an error if withParners is true and isFavorite is either true or false', async () => {
      await expect(
        sut.getTimeBucket(authStub.admin, {
          timeBucket: 'bucket',
          isFavorite: true,
          withPartners: true,
          userId: authStub.admin.user.id,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        sut.getTimeBucket(authStub.admin, {
          timeBucket: 'bucket',
          isFavorite: false,
          withPartners: true,
          userId: authStub.admin.user.id,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw an error if withParners is true and isTrash is true', async () => {
      await expect(
        sut.getTimeBucket(authStub.admin, {
          timeBucket: 'bucket',
          isTrashed: true,
          withPartners: true,
          userId: authStub.admin.user.id,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
