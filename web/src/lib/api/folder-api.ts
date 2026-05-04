import { defaults, type AssetResponseDto } from '@immich/sdk';

export enum FolderUserRole {
  Owner = 'owner',
  Administrator = 'administrator',
  Editor = 'editor',
  Contributor = 'contributor',
  ViewerDownload = 'viewer_download',
  Viewer = 'viewer',
}

export enum FolderEffect {
  Allow = 'allow',
  Deny = 'deny',
}

export interface FolderRestrictions {
  noDownload?: boolean;
  noRawDownload?: boolean;
}

export interface FolderUserDto {
  userId: string;
  name: string;
  email: string;
  profileImagePath: string;
  role: FolderUserRole;
  effect: FolderEffect;
  restrictions: FolderRestrictions;
  validFrom: string | null;
  validUntil: string | null;
}

export interface FolderResponseDto {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  hasChildren: boolean;
  assetCount: number;
  shared: boolean;
  folderUsers: FolderUserDto[];
}

export interface FolderBreadcrumb {
  id: string;
  name: string;
  depth: number;
}

export interface FolderOperations {
  canView: boolean;
  canDownload: boolean;
  canUpload: boolean;
  canEdit: boolean;
  canAdmin: boolean;
  canDelete: boolean;
}

export interface FolderEffectivePermissionsDto {
  folderId: string;
  role: FolderUserRole | null;
  effect: FolderEffect;
  isInherited: boolean;
  inheritedFrom: { folderId: string; name: string } | null;
  restrictions: FolderRestrictions;
  operations: FolderOperations;
}

export interface FolderCreateRequest {
  name: string;
  parentId?: string | null;
  description?: string;
}

export interface FolderUpdateRequest {
  name?: string;
  description?: string;
}

export interface FolderMoveRequest {
  parentId: string | null;
}

export interface AddFolderUserRequest {
  userId: string;
  role?: FolderUserRole;
  effect?: FolderEffect;
  restrictions?: FolderRestrictions;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface UpdateFolderUserRequest {
  role?: FolderUserRole;
  effect?: FolderEffect;
  restrictions?: FolderRestrictions;
  validFrom?: string | null;
  validUntil?: string | null;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const fetchFn = defaults.fetch ?? globalThis.fetch;
  const baseUrl = defaults.baseUrl ?? '/api';
  const headers: Record<string, string> = {
    ...((defaults.headers as Record<string, string>) ?? {}),
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (init?.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetchFn(`${baseUrl}/folders${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Folder API ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export function getRootFolders(): Promise<FolderResponseDto[]> {
  return apiFetch('');
}

export function getFolder(id: string): Promise<FolderResponseDto> {
  return apiFetch(`/${id}`);
}

export function getFolderChildren(id: string): Promise<FolderResponseDto[]> {
  return apiFetch(`/${id}/children`);
}

export function getFolderBreadcrumbs(id: string): Promise<FolderBreadcrumb[]> {
  return apiFetch(`/${id}/breadcrumbs`);
}

export function getFolderAssets(id: string): Promise<AssetResponseDto[]> {
  return apiFetch(`/${id}/assets`);
}

export function getFolderPermissions(id: string): Promise<FolderEffectivePermissionsDto> {
  return apiFetch(`/${id}/permissions`);
}

export function createFolder(dto: FolderCreateRequest): Promise<FolderResponseDto> {
  return apiFetch('', { method: 'POST', body: JSON.stringify(dto) });
}

export function updateFolder(id: string, dto: FolderUpdateRequest): Promise<FolderResponseDto> {
  return apiFetch(`/${id}`, { method: 'PUT', body: JSON.stringify(dto) });
}

export function moveFolder(id: string, dto: FolderMoveRequest): Promise<FolderResponseDto> {
  return apiFetch(`/${id}/move`, { method: 'PUT', body: JSON.stringify(dto) });
}

export function deleteFolder(id: string): Promise<void> {
  return apiFetch(`/${id}`, { method: 'DELETE' });
}

export function addFolderAssets(id: string, assetIds: string[]): Promise<{ id: string; success: boolean }[]> {
  return apiFetch(`/${id}/assets`, { method: 'PUT', body: JSON.stringify({ assetIds }) });
}

export function removeFolderAssets(id: string, ids: string[]): Promise<{ id: string; success: boolean }[]> {
  return apiFetch(`/${id}/assets`, { method: 'DELETE', body: JSON.stringify({ ids }) });
}

export function addFolderUsers(id: string, folderUsers: AddFolderUserRequest[]): Promise<FolderResponseDto> {
  return apiFetch(`/${id}/users`, { method: 'PUT', body: JSON.stringify({ folderUsers }) });
}

export function updateFolderUser(id: string, userId: string, dto: UpdateFolderUserRequest): Promise<void> {
  return apiFetch(`/${id}/user/${userId}`, { method: 'PUT', body: JSON.stringify(dto) });
}

export function removeFolderUser(id: string, userId: string): Promise<void> {
  return apiFetch(`/${id}/user/${userId}`, { method: 'DELETE' });
}
