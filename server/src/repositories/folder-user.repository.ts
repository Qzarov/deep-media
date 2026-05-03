import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Updateable } from 'kysely';
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
      .returning(['userId', 'folderId', 'role'])
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
}
