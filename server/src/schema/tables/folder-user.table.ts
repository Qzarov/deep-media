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
import { AlbumUserRole } from 'src/enum';
import { album_user_role_enum } from 'src/schema/enums';
import { FolderTable } from 'src/schema/tables/folder.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table({ name: 'folder_user' })
@Index({
  name: 'folder_user_unique_owner',
  columns: ['folderId'],
  unique: true,
  where: `role = 'owner'`,
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

  @Column({ enum: album_user_role_enum, default: AlbumUserRole.Editor })
  role!: Generated<AlbumUserRole>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
