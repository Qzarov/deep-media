import { createZodDto } from 'nestjs-zod';
import { AuditLogAction, AuditLogActionSchema, AuditLogResourceType, AuditLogResourceTypeSchema } from 'src/enum';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const AuditLogSchema = z
  .object({
    id: z.string().describe('Audit log ID'),
    createdAt: isoDatetimeToDate.describe('Creation date'),
    actorId: z.string().nullable().describe('User ID that performed the action'),
    actorName: z.string().nullable().describe('Actor display name'),
    actorEmail: z.string().nullable().describe('Actor email'),
    action: AuditLogActionSchema,
    resourceType: AuditLogResourceTypeSchema,
    resourceId: z.string().describe('Resource ID'),
    folderId: z.string().describe('Folder ID'),
    targetUserId: z.string().nullable().describe('Target user ID for ACL changes'),
    metadata: z.record(z.string(), z.unknown()).describe('Action metadata'),
    ipAddress: z.string().nullable().describe('Request IP address'),
    userAgent: z.string().nullable().describe('Request user agent'),
  })
  .meta({ id: 'AuditLogDto' });

const AuditLogSearchSchema = z
  .object({
    action: AuditLogActionSchema.optional().describe('Filter by action'),
    actorId: z.uuidv4().optional().describe('Filter by actor user ID'),
    targetUserId: z.uuidv4().optional().describe('Filter by target user ID'),
    from: isoDatetimeToDate.optional().describe('Filter by creation date from'),
    to: isoDatetimeToDate.optional().describe('Filter by creation date to'),
    limit: z.coerce.number().int().min(1).max(500).default(100).describe('Maximum number of rows'),
  })
  .meta({ id: 'AuditLogSearchDto' });

export class AuditLogDto extends createZodDto(AuditLogSchema) {}
export class AuditLogSearchDto extends createZodDto(AuditLogSearchSchema) {}

export type AuditLogMetadata = Record<string, unknown>;

export type MapAuditLog = {
  id: string;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: AuditLogAction;
  resourceType: AuditLogResourceType;
  resourceId: string;
  folderId: string;
  targetUserId: string | null;
  metadata: AuditLogMetadata | null;
  ipAddress: string | null;
  userAgent: string | null;
};

export const mapAuditLog = (auditLog: MapAuditLog): AuditLogDto => ({
  id: auditLog.id,
  createdAt: auditLog.createdAt,
  actorId: auditLog.actorId,
  actorName: auditLog.actorName,
  actorEmail: auditLog.actorEmail,
  action: auditLog.action,
  resourceType: auditLog.resourceType,
  resourceId: auditLog.resourceId,
  folderId: auditLog.folderId,
  targetUserId: auditLog.targetUserId,
  metadata: auditLog.metadata ?? {},
  ipAddress: auditLog.ipAddress,
  userAgent: auditLog.userAgent,
});
