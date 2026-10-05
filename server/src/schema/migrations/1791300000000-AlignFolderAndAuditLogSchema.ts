import { Kysely, sql } from 'kysely';

// The folder and audit_log migrations were hand-written with their own index and constraint names, so
// schema-check reported drift on every start. This renames them to the names the table definitions
// generate (keeping the existing indexes instead of duplicating them) and adds the few missing ones.
// It does not touch any column or row data.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER INDEX "IDX_audit_log_target_user" RENAME TO "audit_log_targetUserId_idx";`.execute(db);
  await sql`CREATE INDEX "audit_log_actorId_idx" ON "audit_log" ("actorId");`.execute(db);
  await sql`CREATE INDEX "audit_log_resourceId_idx" ON "audit_log" ("resourceId");`.execute(db);
  await sql`CREATE INDEX "audit_log_folderId_idx" ON "audit_log" ("folderId");`.execute(db);
  await sql`ALTER TABLE "audit_log" RENAME CONSTRAINT "PK_audit_log" TO "audit_log_pkey";`.execute(db);
  await sql`ALTER TABLE "audit_log" RENAME CONSTRAINT "FK_audit_log_actor" TO "audit_log_actorId_fkey";`.execute(db);
  await sql`ALTER TABLE "audit_log" RENAME CONSTRAINT "FK_audit_log_target_user" TO "audit_log_targetUserId_fkey";`.execute(
    db,
  );

  await sql`ALTER INDEX "IDX_folder_ownerId" RENAME TO "folder_ownerId_idx";`.execute(db);
  await sql`ALTER INDEX "IDX_folder_parentId" RENAME TO "folder_parentId_idx";`.execute(db);
  await sql`ALTER INDEX "IDX_folder_updateId" RENAME TO "folder_updateId_idx";`.execute(db);
  await sql`ALTER TABLE "folder" RENAME CONSTRAINT "folder_ownerId_parentId_name_key" TO "folder_ownerId_parentId_name_uq";`.execute(
    db,
  );

  await sql`ALTER INDEX "IDX_folder_asset_assetId_folderId" RENAME TO "folder_asset_assetId_folderId_idx";`.execute(db);
  await sql`ALTER INDEX "IDX_folder_asset_assetId" RENAME TO "folder_asset_assetId_idx";`.execute(db);
  await sql`ALTER INDEX "IDX_folder_asset_folderId" RENAME TO "folder_asset_folderId_idx";`.execute(db);

  await sql`ALTER INDEX "IDX_folder_closure_ancestor" RENAME TO "folder_closure_id_ancestor_idx";`.execute(db);
  await sql`ALTER INDEX "IDX_folder_closure_descendant" RENAME TO "folder_closure_id_descendant_idx";`.execute(db);

  await sql`ALTER INDEX "IDX_folder_user_updateId" RENAME TO "folder_user_updateId_idx";`.execute(db);
  await sql`CREATE INDEX "folder_user_folderId_idx" ON "folder_user" ("folderId");`.execute(db);
  await sql`CREATE INDEX "folder_user_userId_idx" ON "folder_user" ("userId");`.execute(db);
  // Same rule, written the way the table definition generates it.
  await sql`DROP INDEX "folder_user_unique_owner";`.execute(db);
  await sql`CREATE UNIQUE INDEX "folder_user_unique_owner" ON "folder_user" ("folderId") WHERE (role = 'owner' AND effect = 'allow');`.execute(
    db,
  );

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_folder_updatedAt', '{"type":"trigger","name":"folder_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"folder_updatedAt\\"\\n  BEFORE UPDATE ON \\"folder\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_folder_user_updatedAt', '{"type":"trigger","name":"folder_user_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"folder_user_updatedAt\\"\\n  BEFORE UPDATE ON \\"folder_user\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_folder_user_unique_owner', '{"type":"index","name":"folder_user_unique_owner","sql":"CREATE UNIQUE INDEX \\"folder_user_unique_owner\\" ON \\"folder_user\\" (\\"folderId\\") WHERE (role = ''owner'' AND effect = ''allow'');"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN ('trigger_folder_updatedAt', 'trigger_folder_user_updatedAt', 'index_folder_user_unique_owner');`.execute(
    db,
  );

  await sql`DROP INDEX "folder_user_userId_idx";`.execute(db);
  await sql`DROP INDEX "folder_user_folderId_idx";`.execute(db);
  await sql`ALTER INDEX "folder_user_updateId_idx" RENAME TO "IDX_folder_user_updateId";`.execute(db);

  await sql`ALTER INDEX "folder_closure_id_descendant_idx" RENAME TO "IDX_folder_closure_descendant";`.execute(db);
  await sql`ALTER INDEX "folder_closure_id_ancestor_idx" RENAME TO "IDX_folder_closure_ancestor";`.execute(db);

  await sql`ALTER INDEX "folder_asset_folderId_idx" RENAME TO "IDX_folder_asset_folderId";`.execute(db);
  await sql`ALTER INDEX "folder_asset_assetId_idx" RENAME TO "IDX_folder_asset_assetId";`.execute(db);
  await sql`ALTER INDEX "folder_asset_assetId_folderId_idx" RENAME TO "IDX_folder_asset_assetId_folderId";`.execute(db);

  await sql`ALTER TABLE "folder" RENAME CONSTRAINT "folder_ownerId_parentId_name_uq" TO "folder_ownerId_parentId_name_key";`.execute(
    db,
  );
  await sql`ALTER INDEX "folder_updateId_idx" RENAME TO "IDX_folder_updateId";`.execute(db);
  await sql`ALTER INDEX "folder_parentId_idx" RENAME TO "IDX_folder_parentId";`.execute(db);
  await sql`ALTER INDEX "folder_ownerId_idx" RENAME TO "IDX_folder_ownerId";`.execute(db);

  await sql`ALTER TABLE "audit_log" RENAME CONSTRAINT "audit_log_targetUserId_fkey" TO "FK_audit_log_target_user";`.execute(
    db,
  );
  await sql`ALTER TABLE "audit_log" RENAME CONSTRAINT "audit_log_actorId_fkey" TO "FK_audit_log_actor";`.execute(db);
  await sql`ALTER TABLE "audit_log" RENAME CONSTRAINT "audit_log_pkey" TO "PK_audit_log";`.execute(db);
  await sql`DROP INDEX "audit_log_folderId_idx";`.execute(db);
  await sql`DROP INDEX "audit_log_resourceId_idx";`.execute(db);
  await sql`DROP INDEX "audit_log_actorId_idx";`.execute(db);
  await sql`ALTER INDEX "audit_log_targetUserId_idx" RENAME TO "IDX_audit_log_target_user";`.execute(db);
}
