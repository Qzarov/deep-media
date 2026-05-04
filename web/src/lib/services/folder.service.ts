import {
  createFolder,
  updateFolder,
  moveFolder,
  deleteFolder as deleteFolderApi,
  addFolderUsers,
  updateFolderUser,
  removeFolderUser,
  addFolderAssets,
  type FolderResponseDto,
  type FolderCreateRequest,
  type FolderUpdateRequest,
  type FolderMoveRequest,
  type AddFolderUserRequest,
  type UpdateFolderUserRequest,
} from '$lib/api/folder-api';
import { modalManager, toastManager, type ActionItem } from '@immich/ui';
import { mdiFolderPlusOutline } from '@mdi/js';
import { goto } from '$app/navigation';
import { eventManager } from '$lib/managers/event-manager.svelte';
import FolderCreateModal from '$lib/modals/FolderCreateModal.svelte';
import { Route } from '$lib/route';
import { handleError } from '$lib/utils/handle-error';
import { getFormatter } from '$lib/utils/i18n';

export const getFolderActions = () => {
  const Create: ActionItem = {
    title: 'Create folder',
    icon: mdiFolderPlusOutline,
    onAction: () => modalManager.show(FolderCreateModal, {}),
  };

  return { Create };
};

export const handleCreateFolder = async (dto: FolderCreateRequest): Promise<FolderResponseDto | undefined> => {
  const $t = await getFormatter();

  try {
    const folder = await createFolder(dto);
    eventManager.emit('FolderCreate', folder);
    toastManager.primary({
      description: $t('folder_created', { values: { name: folder.name } }),
      button: { label: $t('view'), onclick: () => goto(Route.viewFolder({ id: folder.id })) },
    });
    return folder;
  } catch (error) {
    handleError(error, $t('error_creating_folder'));
  }
};

export const handleUpdateFolder = async (id: string, dto: FolderUpdateRequest): Promise<boolean> => {
  const $t = await getFormatter();

  try {
    const folder = await updateFolder(id, dto);
    eventManager.emit('FolderUpdate', folder);
    toastManager.primary({ description: $t('folder_updated') });
    return true;
  } catch (error) {
    handleError(error, $t('error_updating_folder'));
    return false;
  }
};

export const handleMoveFolder = async (id: string, dto: FolderMoveRequest): Promise<boolean> => {
  const $t = await getFormatter();

  try {
    const folder = await moveFolder(id, dto);
    eventManager.emit('FolderUpdate', folder);
    toastManager.primary({ description: $t('folder_moved') });
    return true;
  } catch (error) {
    handleError(error, $t('error_moving_folder'));
    return false;
  }
};

export const handleDeleteFolder = async (folder: FolderResponseDto): Promise<boolean> => {
  const $t = await getFormatter();

  const confirmed = await modalManager.showDialog({
    prompt: $t('folder_delete_confirmation', { values: { name: folder.name } }),
  });

  if (!confirmed) {
    return false;
  }

  try {
    await deleteFolderApi(folder.id);
    eventManager.emit('FolderDelete', { id: folder.id });
    toastManager.primary({ description: $t('folder_deleted') });
    return true;
  } catch (error) {
    handleError(error, $t('error_deleting_folder'));
    return false;
  }
};

export const handleAddFolderUsers = async (folderId: string, users: AddFolderUserRequest[]): Promise<boolean> => {
  const $t = await getFormatter();

  try {
    const folder = await addFolderUsers(folderId, users);
    eventManager.emit('FolderShare', folder);
    toastManager.primary({ description: $t('folder_shared') });
    return true;
  } catch (error) {
    handleError(error, $t('error_sharing_folder'));
    return false;
  }
};

export const handleUpdateFolderUser = async (
  folderId: string,
  userId: string,
  dto: UpdateFolderUserRequest,
): Promise<boolean> => {
  const $t = await getFormatter();

  try {
    await updateFolderUser(folderId, userId, dto);
    toastManager.primary({ description: $t('folder_user_role_updated') });
    return true;
  } catch (error) {
    handleError(error, $t('error_updating_folder_user_role'));
    return false;
  }
};

export const handleRemoveFolderUser = async (folderId: string, userId: string): Promise<boolean> => {
  const $t = await getFormatter();

  const confirmed = await modalManager.showDialog({
    prompt: $t('folder_remove_user_confirmation'),
  });

  if (!confirmed) {
    return false;
  }

  try {
    await removeFolderUser(folderId, userId);
    toastManager.primary({ description: $t('folder_user_removed') });
    return true;
  } catch (error) {
    handleError(error, $t('error_removing_folder_user'));
    return false;
  }
};

export const handleAddFolderAssets = async (folderId: string, assetIds: string[]): Promise<boolean> => {
  const $t = await getFormatter();

  try {
    const results = await addFolderAssets(folderId, assetIds);
    const successCount = results.filter((r) => r.success).length;
    eventManager.emit('FolderAddAssets', { folderId, assetIds });
    toastManager.primary({
      description: $t('assets_added_count', { values: { count: successCount } }),
    });
    return true;
  } catch (error) {
    handleError(error, $t('error_adding_assets_to_folder'));
    return false;
  }
};
