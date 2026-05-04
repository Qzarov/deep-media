import { QueryParameter } from '$lib/constants';
import { foldersStore } from '$lib/stores/folders.svelte';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const [, $t] = await Promise.all([foldersStore.fetchTree(), getFormatter()]);

  let tree = foldersStore.folders!;
  const path = url.searchParams.get(QueryParameter.PATH);
  if (path) {
    tree = tree.traverse(path);
  } else if (path === null) {
    foldersStore.bustAssetCache();
  }

  const pathAssets = tree.hasAssets ? await foldersStore.fetchAssetsByPath(tree.path) : null;

  let rootFolders = foldersStore.rootFolders;
  if (!path && rootFolders.length === 0) {
    try {
      rootFolders = await foldersStore.fetchRootFolders();
    } catch {
      rootFolders = [];
    }
  }

  return {
    tree,
    pathAssets,
    rootFolders,
    meta: {
      title: $t('folders'),
    },
  };
}) satisfies PageLoad;
