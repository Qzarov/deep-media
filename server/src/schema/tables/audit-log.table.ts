import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
} from '@immich/sql-tools';
import { AuditLogAction, AuditLogResourceType } from 'src/enum';
import { UserTable } from 'src/schema/tables/user.table';

@Table('audit_log')
export class AuditLogTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  actorId!: string | null;

  @Column({ type: 'character varying' })
  action!: AuditLogAction;

  @Column({ type: 'character varying' })
  resourceType!: AuditLogResourceType;

  @Column({ type: 'uuid', index: true })
  resourceId!: string;

  @Column({ type: 'uuid', index: true })
  folderId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  targetUserId!: string | null;

  @Column({ type: 'jsonb', default: "'{}'" })
  metadata!: Generated<Record<string, unknown>>;

  @Column({ type: 'text', nullable: true })
  ipAddress!: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent!: string | null;
}
