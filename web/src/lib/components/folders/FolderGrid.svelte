<script lang="ts">
  import type { FolderResponseDto } from '$lib/api/folder-api';
  import { Route } from '$lib/route';
  import { Icon, Text } from '@immich/ui';
  import { mdiFolder } from '@mdi/js';

  interface Props {
    folders: FolderResponseDto[];
  }

  let { folders }: Props = $props();
</script>

{#if folders.length > 0}
  <div
    class="grid w-full grid-cols-2 gap-2 rounded-2xl border border-gray-100 bg-gray-50 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8 dark:border-gray-900 dark:bg-immich-dark-gray/50"
  >
    {#each folders as folder (folder.id)}
      <a
        class="flex flex-col place-items-center gap-2 rounded-xl px-4 py-2 hover:bg-immich-primary/10 dark:hover:bg-immich-primary/40"
        href={Route.viewFolder({ id: folder.id })}
        title={folder.name}
      >
        <Icon icon={mdiFolder} class="text-primary" size="64" />
        <p class="w-full overflow-clip text-sm text-nowrap text-ellipsis whitespace-pre-wrap dark:text-gray-200">
          {folder.name}
        </p>
        <Text size="tiny" class="text-gray-400">
          {folder.assetCount} assets
        </Text>
      </a>
    {/each}
  </div>
{/if}
