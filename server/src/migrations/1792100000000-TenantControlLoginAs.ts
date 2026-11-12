import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [Epic 99 / #3783] Login as + tenant control storage.
 *
 * - `impersonation_sessions`: one row per Login as request/session.
 * - `platform_school_notes`, `platform_announcements`: cockpit records.
 * - `audit_logs.impersonated_by_platform_admin_id` / `impersonation_session_id`: who and which
 *   session is behind a row. Both FKs are RESTRICT (not SET NULL): `trg_audit_logs_write_only`
 *   blocks every UPDATE and DELETE and SET NULL is an UPDATE. Adding nullable columns with no
 *   default rewrites no row, so the trigger is left alone (unlike 1785749259955).
 * - 16 new `audit_logs.action` values, same order as `AuditAction` in `@biddaloy/shared`.
 *
 * `ADD VALUE IF NOT EXISTS` is allowed inside the migration transaction on Postgres 12+; the new
 * values are not used here. Postgres cannot drop enum values, so `down()` leaves them in place
 * (harmless; `up()` is idempotent about them).
 */
const AUDIT_VALUES = [
  'IMPERSONATION_STARTED',
  'IMPERSONATION_ENDED',
  'SUPPORT_ACCESS_MODE_CHANGED',
  'SUPPORT_ACCESS_CONFIRMED',
  'SUPPORT_ACCESS_REQUESTED',
  'SUPPORT_ACCESS_APPROVED',
  'SUPPORT_ACCESS_DENIED',
  'PLATFORM_SCHOOL_NOTE_ADDED',
  'PLATFORM_SCHOOL_RENAMED',
  'PLATFORM_SCHOOL_ARCHIVED',
  'PLATFORM_ADMIN_RESET_SENT',
  'PLATFORM_SCHOOL_LOGOUT_ALL',
  'PLATFORM_USER_LOGOUT',
  'PLATFORM_ANNOUNCEMENT_SENT',
  'PLATFORM_QUEUE_RETRY',
  'PLATFORM_RESTORE_LOCK_RELEASED',
];

export class TenantControlLoginAs1792100000000 implements MigrationInterface {
  name = 'TenantControlLoginAs1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const v of AUDIT_VALUES) {
      await queryRunner.query(
        `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE IF NOT EXISTS '${v}'`,
      );
    }

    await queryRunner.query(`
      CREATE TABLE "impersonation_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "platform_admin_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "target_user_id" uuid NOT NULL,
        "role" varchar(20) NOT NULL,
        "status" varchar(12) NOT NULL,
        "entry_kind" varchar(10) NOT NULL,
        "view_only" boolean NOT NULL DEFAULT true,
        "write_locked" boolean NOT NULL DEFAULT false,
        "write_requested_at" timestamptz,
        "reason" text NOT NULL,
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "decided_by" uuid,
        "decided_at" timestamptz,
        "ticket_expires_at" timestamptz,
        "started_at" timestamptz,
        "expires_at" timestamptz,
        "ended_at" timestamptz,
        "ended_by" varchar(16),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_impersonation_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_impersonation_sessions_status" CHECK ("status" IN ('REQUESTED', 'APPROVED', 'ACTIVE', 'ENDED', 'EXPIRED', 'DENIED')),
        CONSTRAINT "CHK_impersonation_sessions_entry_kind" CHECK ("entry_kind" IN ('NORMAL', 'EMERGENCY')),
        CONSTRAINT "CHK_impersonation_sessions_reason" CHECK (char_length(btrim("reason")) > 0),
        CONSTRAINT "FK_impersonation_sessions_platform_admin_id" FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_impersonation_sessions_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_impersonation_sessions_target_user_id" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_impersonation_sessions_decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_impersonation_sessions_admin_status" ON "impersonation_sessions" ("platform_admin_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_impersonation_sessions_tenant_created" ON "impersonation_sessions" ("tenant_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_impersonation_sessions_status_expires" ON "impersonation_sessions" ("status", "expires_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "platform_school_notes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "author_id" uuid NOT NULL,
        "body" varchar(2000) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_school_notes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_platform_school_notes_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_platform_school_notes_author_id" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_platform_school_notes_tenant_created" ON "platform_school_notes" ("tenant_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "platform_announcements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_by" uuid NOT NULL,
        "title" varchar(200) NOT NULL,
        "body" text NOT NULL,
        "status_filter" jsonb NOT NULL,
        "channels" jsonb NOT NULL,
        "recipient_count" integer NOT NULL DEFAULT 0,
        "idempotency_key" varchar(80),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_announcements" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_platform_announcements_idempotency_key" UNIQUE ("idempotency_key"),
        CONSTRAINT "FK_platform_announcements_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT
      )`);

    await queryRunner.query(`
      ALTER TABLE "audit_logs"
        ADD COLUMN "impersonated_by_platform_admin_id" uuid,
        ADD COLUMN "impersonation_session_id" uuid,
        ADD CONSTRAINT "FK_al_impersonated_by_platform_admin" FOREIGN KEY ("impersonated_by_platform_admin_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_al_impersonation_session" FOREIGN KEY ("impersonation_session_id") REFERENCES "impersonation_sessions"("id") ON DELETE RESTRICT`);
    await queryRunner.query(
      `CREATE INDEX "IDX_al_impersonation_session" ON "audit_logs" ("impersonation_session_id") WHERE "impersonation_session_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_al_tenant_created" ON "audit_logs" ("tenant_id", "created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_al_tenant_created"`);
    await queryRunner.query(`DROP INDEX "IDX_al_impersonation_session"`);
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
        DROP CONSTRAINT "FK_al_impersonation_session",
        DROP CONSTRAINT "FK_al_impersonated_by_platform_admin",
        DROP COLUMN "impersonation_session_id",
        DROP COLUMN "impersonated_by_platform_admin_id"`);
    await queryRunner.query(`DROP TABLE "platform_announcements"`);
    await queryRunner.query(`DROP TABLE "platform_school_notes"`);
    await queryRunner.query(`DROP TABLE "impersonation_sessions"`);
  }
}
