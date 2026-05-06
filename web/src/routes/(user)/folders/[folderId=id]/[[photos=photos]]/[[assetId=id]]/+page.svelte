<script lang="ts">
  import { afterNavigate, goto, invalidateAll } from '$app/navigation';
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import FolderBreadcrumbs from '$lib/components/folders/FolderBreadcrumbs.svelte';
  import FolderGrid from '$lib/components/folders/FolderGrid.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import GalleryViewer from '$lib/components/shared-components/gallery-viewer/GalleryViewer.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import type { Viewport } from '$lib/managers/timeline-manager/types';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { handleDeleteFolder } from '$lib/services/folder.service';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import { ActionButton, CommandPaletteDefaultProvider, IconButton, Text } from '@immich/ui';
  import { mdiDotsVertical, mdiFolderRemoveOutline, mdiFolderPlusOutline, mdiSelectAll } from '@mdi/js';
  import { modalManager } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';
  import FolderCreateModal from '$lib/modals/FolderCreateModal.svelte';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const viewport: Viewport = $state({ width: 0, height: 0 });

  afterNavigate(() => {
    assetMultiSelectManager.clear();
  });

  const triggerAssetUpdate = async () => {
    assetMultiSelectManager.clear();
    await invalidateAll();
  };

  const handleSetVisibility = () => {
    void triggerAssetUpdate();
  };

  const handleSelectAllAssets = () => {
    if (!data.folderAssets || data.folderAssets.length === 0) {
      return;
    }

    assetMultiSelectManager.selectAssets(data.folderAssets.map((asset) => toTimelineAsset(asset)));
  };

  const onDeleteFolder = async () => {
    if (!data.folder) {
      return;
    }

    const deleted = await handleDeleteFolder(data.folder);
    if (deleted) {
      await goto(data.folder.parentId ? Route.viewFolder({ id: data.folder.parentId }) : Route.folders());
    }
  };

  const onCreateSubfolder = () => {
    void modalManager.show(FolderCreateModal, { parentId: data.folder.id });
  };
</script>

<UserPageLayout title={data.folder.name}>
  <FolderBreadcrumbs breadcrumbs={data.breadcrumbs} currentName={data.folder.name} />

  <section class="mt-2 h-[calc(100%-(--spacing(25)))] overflow-auto immich-scrollbar">
    <div class="mb-2 flex items-center justify-between px-2">
      <Text size="small" class="text-dark/70 dark:text-gray-400">
        {$t('folder_summary', {
          values: {
            assetCount: data.folder.assetCount,
            folderCount: data.childFolders.length,
          },
        })}
      </Text>
      <div class="flex gap-1">
        {#if data.folderPermissions?.operations.canEdit}
          <IconButton
            shape="round"
            color="secondary"
            variant="ghost"
            aria-label={$t('create_subfolder')}
            icon={mdiFolderPlusOutline}
            onclick={onCreateSubfolder}
          />
        {/if}
        {#if data.folderPermissions?.operations.canDelete}
          <IconButton
            shape="round"
            color="secondary"
            variant="ghost"
            aria-label={$t('delete_folder')}
            icon={mdiFolderRemoveOutline}
            onclick={onDeleteFolder}
          />
        {/if}
      </div>
    </div>

    {#if data.childFolders.length > 0}
      <FolderGrid folders={data.childFolders} />
    {/if}

    {#if data.folderAssets && data.folderAssets.length > 0}
      <div bind:clientHeight={viewport.height} bind:clientWidth={viewport.width} class="mt-2">
        <GalleryViewer
          assets={data.folderAssets}
          assetInteraction={assetMultiSelectManager}
          {viewport}
          showAssetName={true}
          pageHeaderOffset={54}
          onReload={triggerAssetUpdate}
        />
      </div>
    {/if}

    {#if data.childFolders.length === 0 && (!data.folderAssets || data.folderAssets.length === 0)}
      <div class="flex h-64 flex-col items-center justify-center text-gray-400">
        <Text>{$t('empty_folder')}</Text>
      </div>
    {/if}
  </section>
</UserPageLayout>

{#if assetMultiSelectManager.selectionActive}
  <div class="fixed inset-s-0 top-0 w-full">
    <AssetSelectControlBar>
      {@const Actions = getAssetBulkActions($t)}
      <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />
      <CreateSharedLink />
      <IconButton
        shape="round"
        color="secondary"
        variant="ghost"
        aria-label={$t('select_all')}
        icon={mdiSelectAll}
        onclick={handleSelectAllAssets}
      />
      <ActionButton action={Actions.AddToAlbum} />
      <FavoriteAction
        removeFavorite={assetMultiSelectManager.isAllFavorite}
        onFavorite={function handleFavoriteUpdate(ids, isFavorite) {
          if (data.folderAssets && data.folderAssets.length > 0) {
            for (const id of ids) {
              const asset = data.folderAssets.find((asset) => asset.id === id);
              if (asset) {
                asset.isFavorite = isFavorite;
              }
            }
          }
        }}
      />

      <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
        <DownloadAction menuItem />
        <ChangeDate menuItem />
        <ChangeDescription menuItem />
        <ChangeLocation menuItem />
        <ArchiveAction menuItem unarchive={assetMultiSelectManager.isAllArchived} onArchive={triggerAssetUpdate} />
        <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
        {#if authManager.preferences.tags.enabled && assetMultiSelectManager.isAllUserOwned}
          <TagAction menuItem />
        {/if}
        <DeleteAssets menuItem onAssetDelete={triggerAssetUpdate} onUndoDelete={triggerAssetUpdate} />
        <hr />

        <ActionMenuItem action={Actions.RegenerateThumbnailJob} />
        <ActionMenuItem action={Actions.RefreshMetadataJob} />
        <ActionMenuItem action={Actions.TranscodeVideoJob} />
      </ButtonContextMenu>
    </AssetSelectControlBar>
  </div>
{/if}
