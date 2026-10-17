import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, Insertable, Kysely, sql, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { LibraryStatsResponseDto } from 'src/dtos/library.dto';
import { AssetStatus, AssetType, AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import { AssetTable } from 'src/schema/tables/asset.table';
import { LibraryTable } from 'src/schema/tables/library.table';

export enum AssetSyncResult {
  DO_NOTHING,
  UPDATE,
  OFFLINE,
  CHECK_OFFLINE,
}

@Injectable()
export class LibraryRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  get(id: string, withDeleted = false) {
    return this.db
      .selectFrom('library')
      .selectAll('library')
      .where('library.id', '=', id)
      .$if(!withDeleted, (qb) => qb.where('library.deletedAt', 'is', null))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [] })
  getAll(withDeleted = false) {
    return this.db
      .selectFrom('library')
      .selectAll('library')
      .orderBy('createdAt', 'asc')
      .$if(!withDeleted, (qb) => qb.where('library.deletedAt', 'is', null))
      .execute();
  }

  @GenerateSql()
  getAllDeleted() {
    return this.db
      .selectFrom('library')
      .selectAll('library')
      .where('library.deletedAt', 'is not', null)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  create(library: Insertable<LibraryTable>) {
    return this.db.insertInto('library').values(library).returningAll().executeTakeFirstOrThrow();
  }

  async delete(id: string) {
    await this.db.deleteFrom('library').where('library.id', '=', id).execute();
  }

  async softDelete(id: string) {
    await this.db.updateTable('library').set({ deletedAt: new Date() }).where('library.id', '=', id).execute();
  }

  update(id: string, library: Updateable<LibraryTable>) {
    return this.db
      .updateTable('library')
      .set(library)
      .where('library.id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getStatistics(id: string): Promise<LibraryStatsResponseDto | undefined> {
    const stats = await this.db
      .selectFrom('library')
      .innerJoin('asset', 'asset.libraryId', 'library.id')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select((eb) =>
        eb.fn
          .countAll<number>()
          .filterWhere((eb) =>
            eb.and([eb('asset.type', '=', AssetType.Image), eb('asset.visibility', '!=', AssetVisibility.Hidden)]),
          )
          .as('photos'),
      )
      .select((eb) =>
        eb.fn
          .countAll<number>()
          .filterWhere((eb) =>
            eb.and([eb('asset.type', '=', AssetType.Video), eb('asset.visibility', '!=', AssetVisibility.Hidden)]),
          )
          .as('videos'),
      )
      .select((eb) => eb.fn.coalesce((eb) => eb.fn.sum('asset_exif.fileSizeInByte'), eb.val(0)).as('usage'))
      .groupBy('library.id')
      .where('library.id', '=', id)
      .executeTakeFirst();

    // possibly a new library with 0 assets
    if (!stats) {
      const zero = sql<number>`0::int`;
      return this.db
        .selectFrom('library')
        .select(zero.as('photos'))
        .select(zero.as('videos'))
        .select(zero.as('usage'))
        .select(zero.as('total'))
        .where('library.id', '=', id)
        .executeTakeFirst();
    }

    return {
      photos: stats.photos,
      videos: stats.videos,
      usage: stats.usage,
      total: stats.photos + stats.videos,
    };
  }

  streamAssetIds(libraryId: string, paths?: string[]) {
    return this.db
      .selectFrom('asset')
      .select(['id'])
      .where('libraryId', '=', libraryId)
      .$if(!!paths, (qb) => qb.where((eb) => isUnderPaths(eb, paths!)))
      .stream();
  }

  // Q Space: helpers for moving assets inside a library without changing their ids

  @GenerateSql({ params: [DummyValue.UUID, { id: DummyValue.UUID }] })
  getAssetForMove(libraryId: string, { id, originalPath }: { id?: string; originalPath?: string }) {
    return this.db
      .selectFrom('asset')
      .select(assetForMoveColumns)
      .where('libraryId', '=', libraryId)
      .$if(!!id, (qb) => qb.where('id', '=', id!))
      .$if(!!originalPath, (qb) => qb.where('originalPath', '=', originalPath!))
      .limit(1)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  getAssetsForMoveByPrefix(libraryId: string, prefix: string) {
    return this.db
      .selectFrom('asset')
      .select(assetForMoveColumns)
      .where('libraryId', '=', libraryId)
      .where((eb) => isUnderPaths(eb, [prefix], false))
      .orderBy('originalPath')
      .execute();
  }

  /**
   * Updates the path related columns of an asset in one transaction. When `removeAssetId` is set, that asset
   * (a stale offline row that occupies the target path) is deleted first and the paths of its generated files
   * are returned, so that they can be removed from disk.
   */
  async moveAsset(id: string, values: Updateable<AssetTable>, removeAssetId?: string): Promise<string[]> {
    return this.db.transaction().execute(async (tx) => {
      let files: string[] = [];
      if (removeAssetId) {
        const rows = await tx.selectFrom('asset_file').select('path').where('assetId', '=', removeAssetId).execute();
        files = rows.map(({ path }) => path);
        await tx.deleteFrom('asset').where('id', '=', removeAssetId).execute();
      }

      await tx.updateTable('asset').set(values).where('id', '=', id).execute();
      return files;
    });
  }
  /**
   * Q Space: "permanently deletes" an external asset whose file is still on disk. The row stays as a tombstone
   * (status deleted, deletedAt set) so that the next scan does not import the file again under a new id. Generated
   * data is removed: files (thumbnails, previews, encoded video), faces, embeddings, OCR and job status.
   */
  async tombstoneAsset(id: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('asset')
        .set({ status: AssetStatus.Deleted, deletedAt: sql`coalesce("deletedAt", now())` })
        .where('id', '=', id)
        .execute();
      await tx.deleteFrom('asset_file').where('assetId', '=', id).execute();
      await tx.deleteFrom('asset_face').where('assetId', '=', id).execute();
      await tx.deleteFrom('smart_search').where('assetId', '=', id).execute();
      await tx.deleteFrom('asset_ocr').where('assetId', '=', id).execute();
      await tx.deleteFrom('ocr_search').where('assetId', '=', id).execute();
      await tx.deleteFrom('asset_job_status').where('assetId', '=', id).execute();
    });
  }
}

const assetForMoveColumns = [
  'id',
  'ownerId',
  'libraryId',
  'originalPath',
  'isOffline',
  'isExternal',
  'status',
  'deletedAt',
] as const;

/** `originalPath` is one of the paths or lies below one of them (path separator aware, no LIKE wildcards) */
const isUnderPaths = (eb: ExpressionBuilder<DB, 'asset'>, paths: string[], includeExact = true) =>
  eb.or(
    paths.flatMap((path) => {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const startsWith = sql<boolean>`starts_with(${eb.ref('originalPath')}, ${prefix})`;
      return includeExact ? [eb('originalPath', '=', path), startsWith] : [startsWith];
    }),
  );
