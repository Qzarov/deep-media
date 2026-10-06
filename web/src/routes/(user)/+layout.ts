import { getAuthStatus } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { Route } from '$lib/route';
import { authenticate } from '$lib/utils/auth';
import { getAssetInfoFromParam, isAlbumsRoute, isLockedFolderRoute, isSharedLinkRoute } from '$lib/utils/navigation';
import type { LayoutLoad } from './$types';

export const load = (async ({ url, params, route }) => {
  await authenticate(url, { public: isSharedLinkRoute(route.id) });

  let asset;
  try {
    asset = await getAssetInfoFromParam(params);
  } catch (error) {
    // An asset of a locked album or the Locked Folder is refused once the PIN unlock has expired;
    // this load runs before the page's own check, so ask for the PIN here instead of an error page.
    if (isAlbumsRoute(route.id) || isLockedFolderRoute(route.id)) {
      const { isElevated } = await getAuthStatus();
      if (!isElevated) {
        redirect(307, Route.pinPrompt({ continue: url.pathname + url.search }));
      }
    }
    throw error;
  }

  return {
    asset,
  };
}) satisfies LayoutLoad;
