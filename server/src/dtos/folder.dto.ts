import { createZodDto } from 'nestjs-zod';
import { FolderEffect, FolderEffectSchema, FolderUserRole, FolderUserRoleSchema } from 'src/enum';
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

const FolderRestrictionsSchema = z
  .object({
    noDownload: z.boolean().optional().describe('Block downloading assets'),
    noRawDownload: z.boolean().optional().describe('Block downloading RAW files'),
  })
  .meta({ id: 'FolderRestrictionsDto' });

const FolderUserAddSchema = z
  .object({
    userId: z.uuidv4().describe('User ID to share with'),
    role: FolderUserRoleSchema.default(FolderUserRole.Editor).optional().describe('Role for the user'),
    effect: FolderEffectSchema.default(FolderEffect.Allow).optional().describe('Allow or deny access'),
    restrictions: FolderRestrictionsSchema.optional().describe('Access restrictions'),
    validFrom: z.string().datetime().nullish().describe('Access valid from'),
    validUntil: z.string().datetime().nullish().describe('Access valid until'),
  })
  .meta({ id: 'FolderUserAddDto' });

const AddFolderUsersSchema = z
  .object({
    folderUsers: z.array(FolderUserAddSchema).min(1).describe('Users to add to the folder'),
  })
  .meta({ id: 'AddFolderUsersDto' });

const UpdateFolderUserSchema = z
  .object({
    role: FolderUserRoleSchema.optional().describe('New role for the user'),
    effect: FolderEffectSchema.optional().describe('Allow or deny access'),
    restrictions: FolderRestrictionsSchema.optional().describe('Access restrictions'),
    validFrom: z.string().datetime().nullish().describe('Access valid from'),
    validUntil: z.string().datetime().nullish().describe('Access valid until'),
  })
  .meta({ id: 'UpdateFolderUserDto' });

const FolderUserResponseSchema = z
  .object({
    userId: z.string().describe('User ID'),
    name: z.string().describe('User display name'),
    email: z.string().describe('User email'),
    profileImagePath: z.string().describe('User profile image path'),
    role: FolderUserRoleSchema.describe('User role in folder'),
    effect: FolderEffectSchema.describe('Allow or deny'),
    restrictions: FolderRestrictionsSchema.describe('Access restrictions'),
    validFrom: z.string().nullable().describe('Access valid from'),
    validUntil: z.string().nullable().describe('Access valid until'),
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

const FolderEffectivePermissionsSchema = z
  .object({
    folderId: z.string().describe('Folder ID'),
    role: FolderUserRoleSchema.nullable().describe('Effective role'),
    effect: FolderEffectSchema.describe('Allow or deny'),
    isInherited: z.boolean().describe('Whether permission is inherited from parent'),
    inheritedFrom: z
      .object({
        folderId: z.string(),
        name: z.string(),
      })
      .nullable()
      .describe('Source folder if inherited'),
    restrictions: FolderRestrictionsSchema.describe('Effective restrictions'),
    operations: z
      .object({
        canView: z.boolean(),
        canDownload: z.boolean(),
        canUpload: z.boolean(),
        canEdit: z.boolean(),
        canAdmin: z.boolean(),
        canDelete: z.boolean(),
      })
      .describe('Resolved operation flags'),
  })
  .meta({ id: 'FolderEffectivePermissionsDto' });

const FolderAccessMatrixEntrySchema = z
  .object({
    userId: z.string().describe('User ID'),
    name: z.string().describe('User display name'),
    email: z.string().describe('User email'),
    profileImagePath: z.string().describe('User profile image path'),
    effectiveRole: FolderUserRoleSchema.nullable().describe('Effective role'),
    effect: FolderEffectSchema.describe('Allow or deny'),
    isInherited: z.boolean().describe('Whether inherited from parent'),
    inheritedFrom: z
      .object({
        folderId: z.string(),
        name: z.string(),
      })
      .nullable()
      .describe('Source folder if inherited'),
    restrictions: FolderRestrictionsSchema.describe('Effective restrictions'),
    validFrom: z.string().nullable().describe('Access valid from'),
    validUntil: z.string().nullable().describe('Access valid until'),
  })
  .meta({ id: 'FolderAccessMatrixEntryDto' });

const FolderAccessMatrixSchema = z
  .object({
    folderId: z.string().describe('Folder ID'),
    entries: z.array(FolderAccessMatrixEntrySchema).describe('All users with access'),
  })
  .meta({ id: 'FolderAccessMatrixDto' });

export class FolderCreateDto extends createZodDto(FolderCreateSchema) {}
export class FolderUpdateDto extends createZodDto(FolderUpdateSchema) {}
export class FolderMoveDto extends createZodDto(FolderMoveSchema) {}
export class FolderBulkAssetsDto extends createZodDto(FolderBulkAssetsSchema) {}
export class AddFolderUsersDto extends createZodDto(AddFolderUsersSchema) {}
export class UpdateFolderUserDto extends createZodDto(UpdateFolderUserSchema) {}
export class FolderUserResponseDto extends createZodDto(FolderUserResponseSchema) {}
export class FolderResponseDto extends createZodDto(FolderResponseSchema) {}
export class FolderEffectivePermissionsDto extends createZodDto(FolderEffectivePermissionsSchema) {}
export class FolderAccessMatrixDto extends createZodDto(FolderAccessMatrixSchema) {}

export interface FolderRestrictions {
  noDownload?: boolean;
  noRawDownload?: boolean;
}

export interface FolderUserInfo {
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

export interface EffectivePermission {
  folderId: string;
  folderName: string;
  role: FolderUserRole;
  effect: FolderEffect;
  restrictions: FolderRestrictions;
  depth: number;
  validFrom: string | null;
  validUntil: string | null;
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
      effect: u.effect,
      restrictions: u.restrictions,
      validFrom: u.validFrom,
      validUntil: u.validUntil,
    })),
  };
}
