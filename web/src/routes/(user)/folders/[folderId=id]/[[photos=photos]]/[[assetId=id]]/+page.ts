import { foldersStore } from '$lib/stores/folders.svelte';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ params, url, depends }) => {
  await authenticate(url);

  depends('folder:data');

  const folder = await foldersStore.fetchFolder(params.folderId);

  return {
    folder,
    childFolders: foldersStore.childFolders,
    breadcrumbs: foldersStore.breadcrumbs,
    folderAssets: foldersStore.folderAssets,
    folderPermissions: foldersStore.folderPermissions,
    meta: {
      title: folder.name,
    },
  };
}) satisfies PageLoad;
