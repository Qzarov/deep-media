import { getAlbumInfo, getAuthStatus } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { Route } from '$lib/route';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, url, depends }) => {
  await authenticate(url);

  depends('album:data');

  const album = await getAlbumInfo({ id: params.albumId });

  // A locked album's assets are only served to a PIN-unlocked session.
  if (album.isLocked) {
    const { isElevated } = await getAuthStatus();
    if (!isElevated) {
      redirect(307, Route.pinPrompt({ continue: url.pathname + url.search }));
    }
  }

  return {
    album,
    meta: {
      title: album.albumName,
    },
  };
}) satisfies PageLoad;
