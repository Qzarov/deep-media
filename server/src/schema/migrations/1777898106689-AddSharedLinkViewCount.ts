import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE "shared_link"
      ADD COLUMN "viewCount" integer NOT NULL DEFAULT 0,
      ADD COLUMN "visitLimit" integer;
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE "shared_link"
      DROP COLUMN "viewCount",
      DROP COLUMN "visitLimit";
  `.execute(db);
}
