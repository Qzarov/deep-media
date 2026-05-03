import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { Chunked, ChunkedSet, DummyValue, GenerateSql } from 'src/decorators';
import { FolderWithCounts } from 'src/dtos/folder.dto';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { FolderTable } from 'src/schema/tables/folder.table';

@Injectable()
export class FolderRepository {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(FolderRepository.name);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  get(id: string) {
    return this.db
      .selectFrom('folder')
      .selectAll('folder')
      .where('folder.id', '=', id)
      .where('folder.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getWithCounts(id: string): Promise<FolderWithCounts | undefined> {
    return this.db
      .selectFrom('folder')
      .selectAll('folder')
      .select((eb) => [
        eb
          .selectFrom('folder as child')
          .select(sql<number>`count(*)`.as('count'))
          .whereRef('child.parentId', '=', 'folder.id')
          .where('child.deletedAt', 'is', null)
          .as('childCount'),
        eb
          .selectFrom('folder_asset')
          .select(sql<number>`count(*)`.as('count'))
          .whereRef('folder_asset.folderId', '=', 'folder.id')
          .as('assetCount'),
      ])
      .where('folder.id', '=', id)
      .where('folder.deletedAt', 'is', null)
      .executeTakeFirst()
      .then((row) =>
        row
          ? {
              ...row,
              hasChildren: Number(row.childCount) > 0,
              assetCount: Number(row.assetCount),
            }
          : undefined,
      );
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getRootFolders(ownerId: string): Promise<FolderWithCounts[]> {
    return this.db
      .selectFrom('folder')
      .selectAll('folder')
      .select((eb) => [
        eb
          .selectFrom('folder as child')
          .select(sql<number>`count(*)`.as('count'))
          .whereRef('child.parentId', '=', 'folder.id')
          .where('child.deletedAt', 'is', null)
          .as('childCount'),
        eb
          .selectFrom('folder_asset')
          .select(sql<number>`count(*)`.as('count'))
          .whereRef('folder_asset.folderId', '=', 'folder.id')
          .as('assetCount'),
      ])
      .where('folder.ownerId', '=', ownerId)
      .where('folder.parentId', 'is', null)
      .where('folder.deletedAt', 'is', null)
      .orderBy('folder.name')
      .execute()
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          hasChildren: Number(row.childCount) > 0,
          assetCount: Number(row.assetCount),
        })),
      );
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getChildren(parentId: string): Promise<FolderWithCounts[]> {
    return this.db
      .selectFrom('folder')
      .selectAll('folder')
      .select((eb) => [
        eb
          .selectFrom('folder as child')
          .select(sql<number>`count(*)`.as('count'))
          .whereRef('child.parentId', '=', 'folder.id')
          .where('child.deletedAt', 'is', null)
          .as('childCount'),
        eb
          .selectFrom('folder_asset')
          .select(sql<number>`count(*)`.as('count'))
          .whereRef('folder_asset.folderId', '=', 'folder.id')
          .as('assetCount'),
      ])
      .where('folder.parentId', '=', parentId)
      .where('folder.deletedAt', 'is', null)
      .orderBy('folder.name')
      .execute()
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          hasChildren: Number(row.childCount) > 0,
          assetCount: Number(row.assetCount),
        })),
      );
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getBreadcrumbs(folderId: string) {
    return this.db
      .selectFrom('folder_closure')
      .innerJoin('folder', 'folder.id', 'folder_closure.id_ancestor')
      .select(['folder.id', 'folder.name', 'folder_closure.depth'])
      .where('folder_closure.id_descendant', '=', folderId)
      .where('folder.deletedAt', 'is', null)
      .orderBy('folder_closure.depth', 'desc')
      .execute();
  }

  async create(folder: Insertable<FolderTable>) {
    return this.db.transaction().execute(async (tx) => {
      const created = await tx.insertInto('folder').values(folder).returningAll().executeTakeFirstOrThrow();

      await tx.insertInto('folder_closure').values({ id_ancestor: created.id, id_descendant: created.id, depth: 0 }).execute();

      if (created.parentId) {
        await tx
          .insertInto('folder_closure')
          .columns(['id_ancestor', 'id_descendant', 'depth'])
          .expression(
            tx
              .selectFrom('folder_closure')
              .select([
                'id_ancestor',
                sql.raw<string>(`'${created.id}'`).as('id_descendant'),
                sql.raw<string>(`depth + 1`).as('depth'),
              ])
              .where('id_descendant', '=', created.parentId),
          )
          .execute();
      }

      return created;
    });
  }

  @GenerateSql({ params: [DummyValue.UUID, { name: DummyValue.STRING }] })
  update(id: string, dto: Updateable<FolderTable>) {
    return this.db.updateTable('folder').set(dto).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }

  async move(id: string, newParentId: string | null) {
    return this.db.transaction().execute(async (tx) => {
      // Remove old closure entries (except self-referencing)
      await tx
        .deleteFrom('folder_closure')
        .where('id_descendant', 'in', (qb) =>
          qb.selectFrom('folder_closure').select('id_descendant').where('id_ancestor', '=', id),
        )
        .where('id_ancestor', 'in', (qb) =>
          qb
            .selectFrom('folder_closure')
            .select('id_ancestor')
            .where('id_descendant', '=', id)
            .where('id_ancestor', '!=', id),
        )
        .execute();

      // Update parent reference
      await tx.updateTable('folder').set({ parentId: newParentId }).where('id', '=', id).execute();

      // Rebuild closure entries for new position
      if (newParentId) {
        const subtree = await tx
          .selectFrom('folder_closure')
          .select(['id_descendant', 'depth'])
          .where('id_ancestor', '=', id)
          .execute();

        for (const descendant of subtree) {
          await tx
            .insertInto('folder_closure')
            .columns(['id_ancestor', 'id_descendant', 'depth'])
            .expression(
              tx
                .selectFrom('folder_closure')
                .select([
                  'id_ancestor',
                  sql.raw<string>(`'${descendant.id_descendant}'`).as('id_descendant'),
                  sql.raw<string>(`depth + ${descendant.depth} + 1`).as('depth'),
                ])
                .where('id_descendant', '=', newParentId),
            )
            .execute();
        }
      }
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async softDelete(id: string) {
    const now = new Date().toISOString();
    await this.db
      .updateTable('folder')
      .set({ deletedAt: now })
      .where('id', 'in', (qb) =>
        qb.selectFrom('folder_closure').select('id_descendant').where('id_ancestor', '=', id),
      )
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @Chunked({ paramIndex: 1 })
  async addAssetIds(folderId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .insertInto('folder_asset')
      .values(assetIds.map((assetId) => ({ folderId, assetId })))
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  @Chunked({ paramIndex: 1 })
  async removeAssetIds(folderId: string, assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    await this.db.deleteFrom('folder_asset').where('folderId', '=', folderId).where('assetId', 'in', assetIds).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getAssetIds(folderId: string): Promise<string[]> {
    const results = await this.db
      .selectFrom('folder_asset')
      .select('assetId')
      .where('folderId', '=', folderId)
      .execute();

    return results.map(({ assetId }) => assetId);
  }

  @ChunkedSet({ paramIndex: 1 })
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  async checkOwnerAccess(userId: string, folderIds: Set<string>): Promise<Set<string>> {
    if (folderIds.size === 0) {
      return new Set();
    }

    return this.db
      .selectFrom('folder')
      .select('folder.id')
      .where('folder.id', 'in', [...folderIds])
      .where('folder.ownerId', '=', userId)
      .where('folder.deletedAt', 'is', null)
      .execute()
      .then((rows) => new Set(rows.map((r) => r.id)));
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, DummyValue.STRING] })
  async checkDuplicateName(ownerId: string, parentId: string | null, name: string): Promise<boolean> {
    const query = this.db
      .selectFrom('folder')
      .select('folder.id')
      .where('folder.ownerId', '=', ownerId)
      .where('folder.name', '=', name)
      .where('folder.deletedAt', 'is', null);

    const result = parentId
      ? await query.where('folder.parentId', '=', parentId).executeTakeFirst()
      : await query.where('folder.parentId', 'is', null).executeTakeFirst();

    return !!result;
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async isDescendantOf(folderId: string, potentialAncestorId: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('folder_closure')
      .select('id_descendant')
      .where('id_ancestor', '=', potentialAncestorId)
      .where('id_descendant', '=', folderId)
      .where('id_ancestor', '!=', 'id_descendant')
      .executeTakeFirst();

    return !!result;
  }
}
