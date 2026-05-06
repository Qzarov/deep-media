import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "audit_log" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "actorId" uuid,
      "action" character varying NOT NULL,
      "resourceType" character varying NOT NULL,
      "resourceId" uuid NOT NULL,
      "folderId" uuid NOT NULL,
      "targetUserId" uuid,
      "metadata" jsonb NOT NULL DEFAULT '{}',
      "ipAddress" text,
      "userAgent" text,
      CONSTRAINT "PK_audit_log" PRIMARY KEY ("id"),
      CONSTRAINT "FK_audit_log_actor" FOREIGN KEY ("actorId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "FK_audit_log_target_user" FOREIGN KEY ("targetUserId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    );

    CREATE INDEX "IDX_audit_log_folder_createdAt" ON "audit_log" ("folderId", "createdAt" DESC);
    CREATE INDEX "IDX_audit_log_actor_createdAt" ON "audit_log" ("actorId", "createdAt" DESC);
    CREATE INDEX "IDX_audit_log_target_user" ON "audit_log" ("targetUserId");
    CREATE INDEX "IDX_audit_log_resource" ON "audit_log" ("resourceType", "resourceId");
    CREATE INDEX "IDX_audit_log_action" ON "audit_log" ("action");
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS "audit_log";
  `.execute(db);
}
