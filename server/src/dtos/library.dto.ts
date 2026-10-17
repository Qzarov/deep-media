import { createZodDto } from 'nestjs-zod';
import { Library } from 'src/database';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const stringArrayMax128 = z
  .array(z.string())
  .max(128)
  .refine((arr) => arr.every((s) => s.trim() !== ''), 'Array items must not be empty')
  .refine((arr) => new Set(arr).size === arr.length, 'Array must have unique items');

const CreateLibrarySchema = z
  .object({
    ownerId: z.uuidv4().describe('Owner user ID'),
    name: z.string().min(1).optional().describe('Library name'),
    importPaths: stringArrayMax128.optional().describe('Import paths (max 128)'),
    exclusionPatterns: stringArrayMax128.optional().describe('Exclusion patterns (max 128)'),
  })
  .meta({ id: 'CreateLibraryDto' });

const UpdateLibrarySchema = z
  .object({
    name: z.string().min(1).optional().describe('Library name'),
    importPaths: stringArrayMax128.optional().describe('Import paths (max 128)'),
    exclusionPatterns: stringArrayMax128.optional().describe('Exclusion patterns (max 128)'),
  })
  .meta({ id: 'UpdateLibraryDto' });

export interface CrawlOptionsDto {
  pathsToCrawl: string[];
  includeHidden?: boolean;
  exclusionPatterns?: string[];
}

export interface WalkOptionsDto extends CrawlOptionsDto {
  take: number;
}

const ValidateLibrarySchema = z
  .object({
    importPaths: stringArrayMax128.optional().describe('Import paths to validate (max 128)'),
    exclusionPatterns: stringArrayMax128.optional().describe('Exclusion patterns (max 128)'),
  })
  .meta({ id: 'ValidateLibraryDto' });

const ValidateLibraryImportPathResponseSchema = z
  .object({
    importPath: z.string().describe('Import path'),
    isValid: z.boolean().describe('Is valid'),
    message: z.string().optional().describe('Validation message'),
  })
  .meta({ id: 'ValidateLibraryImportPathResponseDto' });

const ValidateLibraryResponseSchema = z
  .object({
    importPaths: z
      .array(ValidateLibraryImportPathResponseSchema)
      .optional()
      .describe('Validation results for import paths'),
  })
  .meta({ id: 'ValidateLibraryResponseDto' });

const LibraryResponseSchema = z
  .object({
    id: z.string().describe('Library ID'),
    ownerId: z.string().describe('Owner user ID'),
    name: z.string().describe('Library name'),
    assetCount: z.int().describe('Number of assets'),
    importPaths: z.array(z.string()).describe('Import paths'),
    exclusionPatterns: z.array(z.string()).describe('Exclusion patterns'),
    createdAt: isoDatetimeToDate.describe('Creation date'),
    updatedAt: isoDatetimeToDate.describe('Last update date'),
    refreshedAt: isoDatetimeToDate.nullable().describe('Last refresh date'),
  })
  .meta({ id: 'LibraryResponseDto' });

const LibraryStatsResponseSchema = z
  .object({
    photos: z.int().describe('Number of photos'),
    videos: z.int().describe('Number of videos'),
    total: z.int().describe('Total number of assets'),
    usage: z.int().describe('Storage usage in bytes'),
  })
  .meta({ id: 'LibraryStatsResponseDto' });

// Q Space: scan only selected folders (or files) of a library, on a signal from the storage agent.
// The body is optional (upstream clients send none): a missing body means a full scan.
const ScanLibrarySchema = z
  .preprocess(
    (value) => value ?? {},
    z.object({
      paths: z
        .array(z.string().min(1))
        .min(1)
        .max(1000)
        .optional()
        .describe(
          'Absolute folders or files inside the import paths to scan. When omitted, the whole library is scanned.',
        ),
    }),
  )
  .meta({ id: 'ScanLibraryDto' });

// Q Space: tell the library that files were moved or renamed on disk, keeping the asset ids.
const LibraryAssetMoveItemSchema = z
  .object({
    assetId: z.uuidv4().optional().describe('Asset ID (either assetId or fromPath is required)'),
    fromPath: z.string().min(1).optional().describe('Current original path of the asset'),
    toPath: z.string().min(1).describe('New absolute original path'),
  })
  .refine((item) => !!item.assetId !== !!item.fromPath, 'Exactly one of assetId or fromPath is required')
  .meta({ id: 'LibraryAssetMoveItemDto' });

const LibraryAssetMoveSchema = z
  .object({
    items: z.array(LibraryAssetMoveItemSchema).min(1).max(5000).optional().describe('Assets to move'),
    fromPrefix: z.string().min(1).optional().describe('Folder that was moved (prefix mode)'),
    toPrefix: z.string().min(1).optional().describe('New location of the folder (prefix mode)'),
  })
  .refine(
    (dto) => (dto.items ? !dto.fromPrefix && !dto.toPrefix : !!dto.fromPrefix && !!dto.toPrefix),
    'Either items or both fromPrefix and toPrefix are required',
  )
  .meta({ id: 'LibraryAssetMoveDto' });

export enum LibraryAssetMoveError {
  NotFound = 'not_found',
  InvalidPath = 'invalid_path',
  NotOnDisk = 'not_on_disk',
  Conflict = 'conflict',
  Failed = 'failed',
}

const LibraryAssetMoveResultSchema = z
  .object({
    assetId: z.string().optional().describe('Asset ID'),
    fromPath: z.string().optional().describe('Previous original path'),
    toPath: z.string().describe('Requested original path'),
    success: z.boolean().describe('Whether the asset was moved'),
    error: z.enum(LibraryAssetMoveError).meta({ id: 'LibraryAssetMoveError' }).optional().describe('Error code'),
    message: z.string().optional().describe('Error details'),
  })
  .meta({ id: 'LibraryAssetMoveResultDto' });

const LibraryAssetMoveResponseSchema = z
  .object({
    moved: z.int().describe('Number of moved assets'),
    failed: z.int().describe('Number of failed items'),
    items: z.array(LibraryAssetMoveResultSchema).describe('Per item results, in request order'),
  })
  .meta({ id: 'LibraryAssetMoveResponseDto' });

export class CreateLibraryDto extends createZodDto(CreateLibrarySchema) {}
export class UpdateLibraryDto extends createZodDto(UpdateLibrarySchema) {}
export class ValidateLibraryDto extends createZodDto(ValidateLibrarySchema) {}
export class ValidateLibraryResponseDto extends createZodDto(ValidateLibraryResponseSchema) {}
export class ValidateLibraryImportPathResponseDto extends createZodDto(ValidateLibraryImportPathResponseSchema) {}
export class LibraryResponseDto extends createZodDto(LibraryResponseSchema) {}
export class LibraryStatsResponseDto extends createZodDto(LibraryStatsResponseSchema) {}
export class ScanLibraryDto extends createZodDto(ScanLibrarySchema) {}
export class LibraryAssetMoveDto extends createZodDto(LibraryAssetMoveSchema) {}
export class LibraryAssetMoveResultDto extends createZodDto(LibraryAssetMoveResultSchema) {}
export class LibraryAssetMoveResponseDto extends createZodDto(LibraryAssetMoveResponseSchema) {}

export function mapLibrary(entity: Library): LibraryResponseDto {
  let assetCount = 0;
  if (entity.assets) {
    assetCount = entity.assets.length;
  }
  return {
    id: entity.id,
    ownerId: entity.ownerId,
    name: entity.name,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    refreshedAt: entity.refreshedAt,
    assetCount,
    importPaths: entity.importPaths,
    exclusionPatterns: entity.exclusionPatterns,
  };
}
