import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { FolderEffect, FolderUserRole } from 'src/enum';
import { FolderTable } from 'src/schema/tables/folder.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table({ name: 'folder_user' })
@Index({
  name: 'folder_user_unique_owner',
  columns: ['folderId'],
  unique: true,
  where: `role = 'owner' AND effect = 'allow'`,
})
@UpdatedAtTrigger('folder_user_updatedAt')
export class FolderUserTable {
  @ForeignKeyColumn(() => FolderTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    nullable: false,
    primary: true,
  })
  folderId!: string;

  @ForeignKeyColumn(() => UserTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    nullable: false,
    primary: true,
  })
  userId!: string;

  @Column({ type: 'character varying', default: FolderUserRole.Editor })
  role!: Generated<FolderUserRole>;

  @Column({ type: 'character varying', default: FolderEffect.Allow })
  effect!: Generated<FolderEffect>;

  @Column({ type: 'jsonb', default: '{}' })
  restrictions!: Generated<string>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  validFrom!: Timestamp | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  validUntil!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
