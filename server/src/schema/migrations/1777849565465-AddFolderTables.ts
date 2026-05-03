import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "folder" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7() PRIMARY KEY,
      "ownerId" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "parentId" uuid REFERENCES "folder"("id") ON DELETE CASCADE,
      "name" varchar NOT NULL,
      "description" text NOT NULL DEFAULT '',
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      UNIQUE ("ownerId", "parentId", "name")
    );

    CREATE INDEX "IDX_folder_ownerId" ON "folder" ("ownerId");
    CREATE INDEX "IDX_folder_parentId" ON "folder" ("parentId");
    CREATE INDEX "IDX_folder_updateId" ON "folder" ("updateId");

    CREATE TRIGGER "folder_updatedAt"
      BEFORE UPDATE ON "folder"
      FOR EACH ROW EXECUTE FUNCTION updated_at();

    CREATE TABLE "folder_closure" (
      "id_ancestor" uuid NOT NULL REFERENCES "folder"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      "id_descendant" uuid NOT NULL REFERENCES "folder"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
      "depth" integer NOT NULL DEFAULT 0,
      PRIMARY KEY ("id_ancestor", "id_descendant")
    );

    CREATE INDEX "IDX_folder_closure_ancestor" ON "folder_closure" ("id_ancestor");
    CREATE INDEX "IDX_folder_closure_descendant" ON "folder_closure" ("id_descendant");

    CREATE TABLE "folder_asset" (
      "assetId" uuid NOT NULL REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "folderId" uuid NOT NULL REFERENCES "folder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      PRIMARY KEY ("assetId", "folderId")
    );

    CREATE INDEX "IDX_folder_asset_assetId" ON "folder_asset" ("assetId");
    CREATE INDEX "IDX_folder_asset_folderId" ON "folder_asset" ("folderId");
    CREATE INDEX "IDX_folder_asset_assetId_folderId" ON "folder_asset" ("assetId", "folderId");

    CREATE TABLE "folder_user" (
      "folderId" uuid NOT NULL REFERENCES "folder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "userId" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "role" character varying NOT NULL DEFAULT 'editor',
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      PRIMARY KEY ("folderId", "userId")
    );

    CREATE UNIQUE INDEX "folder_user_unique_owner" ON "folder_user" ("folderId") WHERE role = 'owner';
    CREATE INDEX "IDX_folder_user_updateId" ON "folder_user" ("updateId");

    CREATE TRIGGER "folder_user_updatedAt"
      BEFORE UPDATE ON "folder_user"
      FOR EACH ROW EXECUTE FUNCTION updated_at();
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS "folder_user";
    DROP TABLE IF EXISTS "folder_asset";
    DROP TABLE IF EXISTS "folder_closure";
    DROP TABLE IF EXISTS "folder";
  `.execute(db);
}
