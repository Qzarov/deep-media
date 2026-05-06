<script lang="ts">
  import type { FolderBreadcrumb } from '$lib/api/folder-api';
  import { Route } from '$lib/route';
  import { Icon, IconButton } from '@immich/ui';
  import { mdiArrowUpLeft, mdiChevronRight, mdiFolderHome } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    breadcrumbs: FolderBreadcrumb[];
    currentName: string;
  }

  const { breadcrumbs, currentName }: Props = $props();

  const ancestors = $derived(breadcrumbs.slice(0, -1));
  const parentCrumb = $derived(ancestors.at(-1) ?? null);
  const parentLink = $derived(parentCrumb ? Route.viewFolder({ id: parentCrumb.id }) : Route.folders());
</script>

<nav class="flex items-center py-2">
  <div>
    <IconButton
      shape="round"
      color="secondary"
      variant="ghost"
      icon={mdiArrowUpLeft}
      aria-label={$t('to_parent')}
      href={parentLink}
      class="me-2"
    />
  </div>

  <div
    class="w-full overflow-y-auto rounded-2xl border border-gray-100 bg-gray-50 p-2 immich-scrollbar dark:border-gray-900 dark:bg-immich-dark-gray/50"
  >
    <ol class="flex items-center gap-2">
      <li>
        <IconButton
          shape="round"
          color="secondary"
          variant="ghost"
          icon={mdiFolderHome}
          href={Route.folders()}
          aria-label={$t('folders')}
          size="medium"
        />
      </li>
      {#each ancestors as crumb (crumb.id)}
        <li class="flex items-center gap-2 font-mono text-sm text-nowrap text-primary">
          <Icon icon={mdiChevronRight} class="text-gray-500 dark:text-gray-300" size="16" aria-hidden />
          <a class="whitespace-pre-wrap underline hover:font-semibold" href={Route.viewFolder({ id: crumb.id })}>
            {crumb.name}
          </a>
        </li>
      {/each}

      <li class="flex items-center gap-2 font-mono text-sm text-nowrap text-primary">
        <Icon icon={mdiChevronRight} class="text-gray-500 dark:text-gray-300" size="16" aria-hidden />
        <p class="cursor-default whitespace-pre-wrap">{currentName}</p>
      </li>
    </ol>
  </div>
</nav>
