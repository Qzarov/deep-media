import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  ForeignKeyColumn,
  Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  Unique,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { UserTable } from 'src/schema/tables/user.table';

@Table('folder')
@UpdatedAtTrigger('folder_updatedAt')
@Unique({ columns: ['ownerId', 'parentId', 'name'] })
export class FolderTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  ownerId!: string;

  @ForeignKeyColumn(() => FolderTable, { nullable: true, onDelete: 'CASCADE' })
  parentId!: string | null;

  @Column()
  name!: string;

  @Column({ type: 'text', default: '' })
  description!: Generated<string>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @DeleteDateColumn()
  deletedAt!: Timestamp | null;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
