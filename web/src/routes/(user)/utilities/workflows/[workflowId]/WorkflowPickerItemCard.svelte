<script lang="ts">
  import { getAssetMediaUrl, getPeopleThumbnailUrl } from '$lib/utils';
  import type { AlbumResponseDto, PersonResponseDto } from '@immich/sdk';
  import { Card, CardBody, Icon, IconButton, Text } from '@immich/ui';
  import { mdiClose, mdiLockOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    item: AlbumResponseDto | PersonResponseDto;
    isAlbum: boolean;
    onRemove: () => void;
  };

  let { item, isAlbum, onRemove }: Props = $props();
</script>

<Card color="secondary">
  <CardBody class="flex items-center gap-3">
    <div class="shrink-0">
      {#if isAlbum && 'albumThumbnailAssetId' in item}
        {#if item.isLocked}
          <div class="flex size-12 items-center justify-center rounded-lg bg-gray-200 text-gray-500 dark:bg-gray-800">
            <Icon icon={mdiLockOutline} size="22" />
          </div>
        {:else if item.albumThumbnailAssetId}
          <img
            src={getAssetMediaUrl({ id: item.albumThumbnailAssetId })}
            alt={item.albumName}
            class="size-12 rounded-lg object-cover"
          />
        {:else}
          <div class="size-12 rounded-lg"></div>
        {/if}
      {:else if !isAlbum && 'name' in item}
        <img src={getPeopleThumbnailUrl(item)} alt={item.name} class="size-12 rounded-full object-cover" />
      {/if}
    </div>
    <div class="min-w-0 flex-1">
      <Text class="truncate" fontWeight="semi-bold">
        {isAlbum && 'albumName' in item ? item.albumName : 'name' in item ? item.name : ''}
      </Text>
      {#if isAlbum && 'assetCount' in item}
        <Text size="small" color="muted">
          {$t('items_count', { values: { count: item.assetCount } })}
        </Text>
      {/if}
    </div>

    <IconButton
      type="button"
      onclick={onRemove}
      class="shrink-0"
      shape="round"
      aria-label={$t('remove')}
      icon={mdiClose}
      size="small"
      variant="ghost"
      color="secondary"
    />
  </CardBody>
</Card>
