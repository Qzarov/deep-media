import { Column, ForeignKeyColumn, Table } from '@immich/sql-tools';
import { FolderTable } from 'src/schema/tables/folder.table';

@Table('folder_closure')
export class FolderClosureTable {
  @ForeignKeyColumn(() => FolderTable, { primary: true, onDelete: 'CASCADE', onUpdate: 'NO ACTION', index: true })
  id_ancestor!: string;

  @ForeignKeyColumn(() => FolderTable, { primary: true, onDelete: 'CASCADE', onUpdate: 'NO ACTION', index: true })
  id_descendant!: string;

  @Column({ type: 'integer', default: 0 })
  depth!: number;
}
