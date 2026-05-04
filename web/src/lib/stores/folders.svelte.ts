import {
  getAssetsByOriginalPath,
  getUniqueOriginalPaths,
  /**
   * TODO: Incorrect type
   */
  type AssetResponseDto,
} from '@immich/sdk';
import {
  getRootFolders,
  getFolder,
  getFolderChildren,
  getFolderBreadcrumbs,
  getFolderAssets,
  getFolderPermissions,
  type FolderResponseDto,
  type FolderBreadcrumb,
  type FolderEffectivePermissionsDto,
} from '$lib/api/folder-api';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { TreeNode } from '$lib/utils/tree-utils';

type AssetCache = {
  [path: string]: AssetResponseDto[];
};

class FoldersStore {
  folders = $state.raw<TreeNode | null>(null);
  private initialized = false;
  private assets = $state<AssetCache>({});

  currentFolder = $state.raw<FolderResponseDto | null>(null);
  rootFolders = $state.raw<FolderResponseDto[]>([]);
  childFolders = $state.raw<FolderResponseDto[]>([]);
  breadcrumbs = $state.raw<FolderBreadcrumb[]>([]);
  folderAssets = $state.raw<AssetResponseDto[]>([]);
  folderPermissions = $state.raw<FolderEffectivePermissionsDto | null>(null);

  constructor() {
    eventManager.on({
      AuthLogout: () => this.clearCache(),
      FolderCreate: () => this.invalidateApiCache(),
      FolderUpdate: () => this.invalidateApiCache(),
      FolderDelete: () => this.invalidateApiCache(),
      FolderShare: () => this.invalidateApiCache(),
      FolderAddAssets: () => this.invalidateApiCache(),
    });
  }

  async fetchTree(): Promise<TreeNode> {
    if (this.initialized) {
      return this.folders!;
    }
    this.folders = TreeNode.fromPaths(await getUniqueOriginalPaths());
    this.folders.collapse();
    this.initialized = true;
    return this.folders;
  }

  bustAssetCache() {
    this.assets = {};
  }

  async refreshAssetsByPath(path: string) {
    return (this.assets[path] = await getAssetsByOriginalPath({ path }));
  }

  async fetchAssetsByPath(path: string) {
    return (this.assets[path] ??= await getAssetsByOriginalPath({ path }));
  }

  async fetchRootFolders(): Promise<FolderResponseDto[]> {
    this.rootFolders = await getRootFolders();
    return this.rootFolders;
  }

  async fetchFolder(id: string): Promise<FolderResponseDto> {
    const [folder, children, crumbs, assets, permissions] = await Promise.all([
      getFolder(id),
      getFolderChildren(id),
      getFolderBreadcrumbs(id),
      getFolderAssets(id),
      getFolderPermissions(id),
    ]);
    this.currentFolder = folder;
    this.childFolders = children;
    this.breadcrumbs = crumbs;
    this.folderAssets = assets;
    this.folderPermissions = permissions;
    return folder;
  }

  private invalidateApiCache() {
    this.currentFolder = null;
    this.rootFolders = [];
    this.childFolders = [];
    this.breadcrumbs = [];
    this.folderAssets = [];
    this.folderPermissions = null;
  }

  clearCache() {
    this.initialized = false;
    this.assets = {};
    this.folders = null;
    this.invalidateApiCache();
  }
}

export const foldersStore = new FoldersStore();
