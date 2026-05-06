import { Insertable, Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { AuditLogSearchDto } from 'src/dtos/audit-log.dto';
import { DB } from 'src/schema';
import { AuditLogTable } from 'src/schema/tables/audit-log.table';

export class AuditLogRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(auditLog: Insertable<AuditLogTable>) {
    return this.db.insertInto('audit_log').values(auditLog).executeTakeFirstOrThrow();
  }

  searchByFolder(folderId: string, dto: AuditLogSearchDto) {
    let query = this.db
      .selectFrom('audit_log')
      .leftJoin('user as actor', 'actor.id', 'audit_log.actorId')
      .select([
        'audit_log.id',
        'audit_log.createdAt',
        'audit_log.actorId',
        'actor.name as actorName',
        'actor.email as actorEmail',
        'audit_log.action',
        'audit_log.resourceType',
        'audit_log.resourceId',
        'audit_log.folderId',
        'audit_log.targetUserId',
        'audit_log.metadata',
        'audit_log.ipAddress',
        'audit_log.userAgent',
      ])
      .where('audit_log.folderId', '=', folderId);

    if (dto.action) {
      query = query.where('audit_log.action', '=', dto.action);
    }
    if (dto.actorId) {
      query = query.where('audit_log.actorId', '=', dto.actorId);
    }
    if (dto.targetUserId) {
      query = query.where('audit_log.targetUserId', '=', dto.targetUserId);
    }
    if (dto.from) {
      query = query.where('audit_log.createdAt', '>=', dto.from);
    }
    if (dto.to) {
      query = query.where('audit_log.createdAt', '<=', dto.to);
    }

    return query.orderBy('audit_log.createdAt', 'desc').limit(dto.limit).execute();
  }
}
