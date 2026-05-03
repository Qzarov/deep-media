import { ForeignKeyColumn, Index, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';
import { FolderTable } from 'src/schema/tables/folder.table';

@Index({ columns: ['assetId', 'folderId'] })
@Table('folder_asset')
export class FolderAssetTable {
  @ForeignKeyColumn(() => AssetTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE', primary: true, index: true })
  assetId!: string;

  @ForeignKeyColumn(() => FolderTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE', primary: true, index: true })
  folderId!: string;
}
