import { Permission } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { checkAccess } from 'src/utils/access';
import { AuthFactory } from 'test/factories/auth.factory';
import { newAccessRepositoryMock } from 'test/repositories/access.repository.mock';
import { newUuid } from 'test/small.factory';
import { beforeEach, describe, expect, it } from 'vitest';

describe('checkAccess with locked albums', () => {
  let access: ReturnType<typeof newAccessRepositoryMock>;
  const repo = () => access as unknown as AccessRepository;

  const [openAsset, lockedAsset] = [newUuid(), newUuid()];
  const [openAlbum, lockedAlbum] = [newUuid(), newUuid()];

  beforeEach(() => {
    access = newAccessRepositoryMock();
    access.asset.checkOwnerAccess.mockResolvedValue(new Set([openAsset, lockedAsset]));
    access.asset.getInLockedAlbum.mockResolvedValue(new Set([lockedAsset]));
    access.album.checkOwnerAccess.mockResolvedValue(new Set([openAlbum, lockedAlbum]));
    access.album.getLocked.mockResolvedValue(new Set([lockedAlbum]));
  });

  it('drops assets of locked albums for a session that is not PIN-unlocked', async () => {
    const auth = AuthFactory.from().session().build();
    await expect(
      checkAccess(repo(), { auth, permission: Permission.AssetView, ids: [openAsset, lockedAsset] }),
    ).resolves.toEqual(new Set([openAsset]));
  });

  it('keeps assets of locked albums for a PIN-unlocked session', async () => {
    const auth = AuthFactory.from().session({ hasElevatedPermission: true }).build();
    await expect(
      checkAccess(repo(), { auth, permission: Permission.AssetDownload, ids: [openAsset, lockedAsset] }),
    ).resolves.toEqual(new Set([openAsset, lockedAsset]));
    expect(access.asset.getInLockedAlbum).not.toHaveBeenCalled();
  });

  it('drops locked albums for album permissions', async () => {
    const auth = AuthFactory.from().session().build();
    for (const permission of [Permission.AlbumRead, Permission.AlbumDownload, Permission.AlbumUpdate]) {
      await expect(checkAccess(repo(), { auth, permission, ids: [openAlbum, lockedAlbum] })).resolves.toEqual(
        new Set([openAlbum]),
      );
    }
  });

  it('lets locked album metadata through when explicitly allowed', async () => {
    const auth = AuthFactory.from().session().build();
    access.album.checkOwnerAccess.mockResolvedValue(new Set([lockedAlbum]));
    await expect(
      checkAccess(repo(), { auth, permission: Permission.AlbumRead, ids: [lockedAlbum], allowLockedAlbums: true }),
    ).resolves.toEqual(new Set([lockedAlbum]));
  });

  it('never opens locked albums or their assets to shared links', async () => {
    const auth = AuthFactory.from().sharedLink({ allowDownload: true }).build();
    access.asset.checkSharedLinkAccess.mockResolvedValue(new Set([openAsset, lockedAsset]));
    access.album.checkSharedLinkAccess.mockResolvedValue(new Set([lockedAlbum]));

    await expect(
      checkAccess(repo(), { auth, permission: Permission.AssetRead, ids: [openAsset, lockedAsset] }),
    ).resolves.toEqual(new Set([openAsset]));
    await expect(
      checkAccess(repo(), { auth, permission: Permission.AlbumRead, ids: [lockedAlbum], allowLockedAlbums: true }),
    ).resolves.toEqual(new Set());
  });

  it('leaves unrelated permissions alone', async () => {
    const auth = AuthFactory.from().session().build();
    access.tag.checkOwnerAccess.mockResolvedValue(new Set([lockedAsset]));
    await expect(checkAccess(repo(), { auth, permission: Permission.TagRead, ids: [lockedAsset] })).resolves.toEqual(
      new Set([lockedAsset]),
    );
  });
});
