<script lang="ts">
  import { cleanClass } from '$lib';
  import AssetCover from '$lib/components/sharedlinks-page/covers/AssetCover.svelte';
  import NoCover from '$lib/components/sharedlinks-page/covers/NoCover.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { type AlbumResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiLockOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    album: AlbumResponseDto;
    preload?: boolean;
    class?: string;
  }

  let { album, preload = false, class: className }: Props = $props();

  let alt = $derived(album.albumName || $t('unnamed_album'));
  let thumbnailUrl = $derived(
    album.albumThumbnailAssetId ? getAssetMediaUrl({ id: album.albumThumbnailAssetId }) : null,
  );
</script>

{#if album.isLocked}
  <!-- Locked albums never show a cover in lists, even in a PIN-unlocked session. -->
  <div
    class={cleanClass(
      'flex aspect-square size-full items-center justify-center rounded-xl bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
      className,
    )}
    role="img"
    aria-label={`${alt} · ${$t('locked_album')}`}
    data-testid="album-image"
  >
    <Icon icon={mdiLockOutline} size="35%" />
  </div>
{:else if thumbnailUrl}
  <AssetCover {alt} class={className} src={thumbnailUrl} {preload} />
{:else}
  <NoCover {alt} class={className} {preload} />
{/if}
