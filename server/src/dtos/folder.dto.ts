import { createZodDto } from 'nestjs-zod';
import { AlbumUserRole, AlbumUserRoleSchema } from 'src/enum';
import { asDateString } from 'src/utils/date';
import z from 'zod';

const FolderCreateSchema = z
  .object({
    name: z.string().min(1).max(255).describe('Folder name'),
    parentId: z.uuidv4().nullish().describe('Parent folder ID'),
    description: z.string().max(1000).optional().describe('Folder description'),
  })
  .meta({ id: 'FolderCreateDto' });

const FolderUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional().describe('Folder name'),
    description: z.string().max(1000).optional().describe('Folder description'),
  })
  .meta({ id: 'FolderUpdateDto' });

const FolderMoveSchema = z
  .object({
    parentId: z.uuidv4().nullable().describe('New parent folder ID, null for root'),
  })
  .meta({ id: 'FolderMoveDto' });

const FolderBulkAssetsSchema = z
  .object({
    assetIds: z.array(z.uuidv4()).describe('Asset IDs to add to folder'),
  })
  .meta({ id: 'FolderBulkAssetsDto' });

const FolderUserAddSchema = z
  .object({
    userId: z.uuidv4().describe('User ID to share with'),
    role: AlbumUserRoleSchema.default(AlbumUserRole.Editor).optional().describe('Role for the user'),
  })
  .meta({ id: 'FolderUserAddDto' });

const AddFolderUsersSchema = z
  .object({
    folderUsers: z.array(FolderUserAddSchema).min(1).describe('Users to add to the folder'),
  })
  .meta({ id: 'AddFolderUsersDto' });

const UpdateFolderUserSchema = z
  .object({
    role: AlbumUserRoleSchema.describe('New role for the user'),
  })
  .meta({ id: 'UpdateFolderUserDto' });

const FolderUserResponseSchema = z
  .object({
    userId: z.string().describe('User ID'),
    name: z.string().describe('User display name'),
    email: z.string().describe('User email'),
    profileImagePath: z.string().describe('User profile image path'),
    role: AlbumUserRoleSchema.describe('User role in folder'),
  })
  .meta({ id: 'FolderUserResponseDto' });

export const FolderResponseSchema = z
  .object({
    id: z.string().describe('Folder ID'),
    name: z.string().describe('Folder name'),
    description: z.string().describe('Folder description'),
    parentId: z.string().nullable().describe('Parent folder ID'),
    ownerId: z.string().describe('Owner user ID'),
    createdAt: z.string().meta({ format: 'date-time' }).describe('Creation date'),
    updatedAt: z.string().meta({ format: 'date-time' }).describe('Last update date'),
    hasChildren: z.boolean().describe('Whether folder has subfolders'),
    assetCount: z.number().describe('Number of assets in this folder'),
    shared: z.boolean().describe('Whether folder is shared with other users'),
    folderUsers: z.array(FolderUserResponseSchema).describe('Users with access to this folder'),
  })
  .meta({ id: 'FolderResponseDto' });

export class FolderCreateDto extends createZodDto(FolderCreateSchema) {}
export class FolderUpdateDto extends createZodDto(FolderUpdateSchema) {}
export class FolderMoveDto extends createZodDto(FolderMoveSchema) {}
export class FolderBulkAssetsDto extends createZodDto(FolderBulkAssetsSchema) {}
export class AddFolderUsersDto extends createZodDto(AddFolderUsersSchema) {}
export class UpdateFolderUserDto extends createZodDto(UpdateFolderUserSchema) {}
export class FolderUserResponseDto extends createZodDto(FolderUserResponseSchema) {}
export class FolderResponseDto extends createZodDto(FolderResponseSchema) {}

export interface FolderUserInfo {
  userId: string;
  name: string;
  email: string;
  profileImagePath: string;
  role: AlbumUserRole;
}

export interface FolderWithCounts {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
  ownerId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  hasChildren: boolean;
  assetCount: number;
}

export function mapFolder(entity: FolderWithCounts, folderUsers: FolderUserInfo[] = []): FolderResponseDto {
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    parentId: entity.parentId,
    ownerId: entity.ownerId,
    createdAt: asDateString(entity.createdAt),
    updatedAt: asDateString(entity.updatedAt),
    hasChildren: entity.hasChildren,
    assetCount: entity.assetCount,
    shared: folderUsers.length > 1,
    folderUsers: folderUsers.map((u) => ({
      userId: u.userId,
      name: u.name,
      email: u.email,
      profileImagePath: u.profileImagePath,
      role: u.role,
    })),
  };
}
