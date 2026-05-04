import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Updateable, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';
import { FolderUserTable } from 'src/schema/tables/folder-user.table';

export type FolderPermissionId = { folderId: string; userId: string };

@Injectable()
export class FolderUserRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [{ folderId: DummyValue.UUID, userId: DummyValue.UUID, role: 'editor' }] })
  create(folderUser: Insertable<FolderUserTable>) {
    return this.db
      .insertInto('folder_user')
      .values(folderUser)
      .returning(['userId', 'folderId', 'role', 'effect', 'restrictions', 'validFrom', 'validUntil'])
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [{ folderId: DummyValue.UUID, userId: DummyValue.UUID }, { role: 'viewer' }] })
  async update({ userId, folderId }: FolderPermissionId, dto: Updateable<FolderUserTable>) {
    await this.db
      .updateTable('folder_user')
      .set(dto)
      .where('userId', '=', userId)
      .where('folderId', '=', folderId)
      .execute();
  }

  @GenerateSql({ params: [{ folderId: DummyValue.UUID, userId: DummyValue.UUID }] })
  async delete({ userId, folderId }: FolderPermissionId): Promise<void> {
    await this.db
      .deleteFrom('folder_user')
      .where('userId', '=', userId)
      .where('folderId', '=', folderId)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getByFolderId(folderId: string) {
    return this.db
      .selectFrom('folder_user')
      .innerJoin('user', 'user.id', 'folder_user.userId')
      .select([
        'folder_user.folderId',
        'folder_user.userId',
        'folder_user.role',
        'folder_user.effect',
        'folder_user.restrictions',
        'folder_user.validFrom',
        'folder_user.validUntil',
        'user.name',
        'user.email',
        'user.profileImagePath',
      ])
      .where('folder_user.folderId', '=', folderId)
      .where('user.deletedAt', 'is', null)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getByFolderAndUser(folderId: string, userId: string) {
    return this.db
      .selectFrom('folder_user')
      .selectAll()
      .where('folderId', '=', folderId)
      .where('userId', '=', userId)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getEffectivePermission(folderId: string, userId: string) {
    return this.db
      .selectFrom('folder_closure as fc')
      .innerJoin('folder_user as fu', 'fu.folderId', 'fc.id_ancestor')
      .innerJoin('folder as f', 'f.id', 'fc.id_ancestor')
      .select([
        'fc.id_ancestor as folderId',
        'f.name as folderName',
        'fu.role',
        'fu.effect',
        'fu.restrictions',
        'fu.validFrom',
        'fu.validUntil',
        'fc.depth',
      ])
      .where('fc.id_descendant', '=', folderId)
      .where('fu.userId', '=', userId)
      .where((eb) =>
        eb.or([eb('fu.validFrom', 'is', null), eb('fu.validFrom', '<=', sql<Date>`now()`)]),
      )
      .where((eb) =>
        eb.or([eb('fu.validUntil', 'is', null), eb('fu.validUntil', '>', sql<Date>`now()`)]),
      )
      .orderBy('fc.depth', 'asc')
      .limit(1)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getAllEffectivePermissions(folderId: string) {
    return this.db
      .selectFrom('folder_closure as fc')
      .innerJoin('folder_user as fu', 'fu.folderId', 'fc.id_ancestor')
      .innerJoin('folder as f', 'f.id', 'fc.id_ancestor')
      .innerJoin('user', 'user.id', 'fu.userId')
      .select([
        'fu.userId',
        'user.name',
        'user.email',
        'user.profileImagePath',
        'fc.id_ancestor as sourceFolderId',
        'f.name as sourceFolderName',
        'fu.role',
        'fu.effect',
        'fu.restrictions',
        'fu.validFrom',
        'fu.validUntil',
        'fc.depth',
      ])
      .where('fc.id_descendant', '=', folderId)
      .where('user.deletedAt', 'is', null)
      .where((eb) =>
        eb.or([eb('fu.validFrom', 'is', null), eb('fu.validFrom', '<=', sql<Date>`now()`)]),
      )
      .where((eb) =>
        eb.or([eb('fu.validUntil', 'is', null), eb('fu.validUntil', '>', sql<Date>`now()`)]),
      )
      .orderBy('fu.userId', 'asc')
      .orderBy('fc.depth', 'asc')
      .execute();
  }
}
