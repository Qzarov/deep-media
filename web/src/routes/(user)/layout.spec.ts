import { getAuthStatus } from '@immich/sdk';
import { load } from './+layout';

vi.mock('@immich/sdk', () => ({ getAuthStatus: vi.fn() }));
vi.mock('$lib/utils/auth', () => ({ authenticate: vi.fn() }));
vi.mock('$lib/managers/AssetCacheManager.svelte', () => ({
  assetCacheManager: { getAsset: vi.fn().mockRejectedValue(new Error('400')) },
}));

const albumRoute = '/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]';
const run = (routeId: string, pathname: string) =>
  (load as unknown as (event: unknown) => Promise<unknown>)({
    url: new URL(`https://media.example${pathname}`),
    params: { assetId: 'a1' },
    route: { id: routeId },
  });

describe('(user) layout load', () => {
  it('asks for the PIN when an asset of a locked album is refused after the unlock expired', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ isElevated: false } as never);
    await expect(run(albumRoute, '/albums/b1/photos/a1')).rejects.toMatchObject({
      status: 307,
      location: '/auth/pin-prompt?continue=%2Falbums%2Fb1%2Fphotos%2Fa1',
    });
  });

  it('asks for the PIN in the Locked Folder too', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ isElevated: false } as never);
    await expect(run('/(user)/locked/[[photos=photos]]/[[assetId=id]]', '/locked/photos/a1')).rejects.toMatchObject({
      status: 307,
    });
  });

  it('keeps the error when the session is unlocked (the asset is really gone)', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ isElevated: true } as never);
    await expect(run(albumRoute, '/albums/b1/photos/a1')).rejects.toThrow('400');
  });

  it('keeps the error outside albums and the Locked Folder', async () => {
    vi.mocked(getAuthStatus).mockClear();
    await expect(run('/(user)/photos/[[assetId=id]]', '/photos/a1')).rejects.toThrow('400');
    expect(getAuthStatus).not.toHaveBeenCalled();
  });
});
