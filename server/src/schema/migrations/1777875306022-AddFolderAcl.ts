import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE "folder_user"
      ADD COLUMN "effect" character varying NOT NULL DEFAULT 'allow',
      ADD COLUMN "restrictions" jsonb NOT NULL DEFAULT '{}',
      ADD COLUMN "validFrom" timestamptz,
      ADD COLUMN "validUntil" timestamptz;

    DROP INDEX "folder_user_unique_owner";
    CREATE UNIQUE INDEX "folder_user_unique_owner"
      ON "folder_user" ("folderId") WHERE role = 'owner' AND effect = 'allow';

    CREATE INDEX "IDX_folder_user_temporal"
      ON "folder_user" ("validUntil") WHERE "validUntil" IS NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS "IDX_folder_user_temporal";
    DROP INDEX IF EXISTS "folder_user_unique_owner";

    ALTER TABLE "folder_user"
      DROP COLUMN "effect",
      DROP COLUMN "restrictions",
      DROP COLUMN "validFrom",
      DROP COLUMN "validUntil";

    CREATE UNIQUE INDEX "folder_user_unique_owner"
      ON "folder_user" ("folderId") WHERE role = 'owner';
  `.execute(db);
}
