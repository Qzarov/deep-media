<script lang="ts">
  import { handleCreateFolder } from '$lib/services/folder.service';
  import { goto } from '$app/navigation';
  import { Route } from '$lib/route';
  import { Field, FormModal, Input, Textarea } from '@immich/ui';
  import { mdiFolderPlusOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    onClose: () => void;
    parentId?: string;
  };

  const { onClose, parentId }: Props = $props();

  let name = $state('');
  let description = $state('');

  const onSubmit = async () => {
    const folder = await handleCreateFolder({
      name,
      parentId: parentId ?? null,
      description: description || undefined,
    });
    if (folder) {
      await goto(Route.viewFolder({ id: folder.id }));
      onClose();
    }
  };
</script>

<FormModal
  size="small"
  title={$t('create_folder')}
  submitText={$t('create')}
  icon={mdiFolderPlusOutline}
  {onClose}
  {onSubmit}
>
  <Field label={$t('name')} required>
    <Input autofocus bind:value={name} />
  </Field>
  <Field label={$t('description')}>
    <Textarea bind:value={description} />
  </Field>
</FormModal>
