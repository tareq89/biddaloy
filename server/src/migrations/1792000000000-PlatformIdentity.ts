import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [Epic 98 / #3734] Platform identity: the owners of the SaaS itself.
 *
 * - `platform_admins`: who is a platform owner. A lock is `users.status = 'SUSPENDED'` (D24); this
 *   table only records who locked and when.
 * - `user_mfa`, `user_recovery_codes`: TOTP secret (encrypted) and hashed one-time recovery codes.
 * - `platform_admin_devices`: devices a platform owner has passed the device OTP on.
 * - `platform_approvals`: two-owner approvals; `platform_settings`: platform-level key/value.
 * - `schools.is_platform`: exactly one school row may carry it (the platform's own school).
 * - 13 new `audit_logs.action` values, same order as `AuditAction` in `@biddaloy/shared`.
 *
 * `ADD VALUE IF NOT EXISTS` is allowed inside the migration transaction on Postgres 12+; the new
 * values are not used in this migration, so that is safe.
 */
const AUDIT_VALUES = [
  'PLATFORM_LOGIN',
  'PLATFORM_LOGIN_FAILED',
  'PLATFORM_OWNER_LOCKED',
  'PLATFORM_OWNER_UNLOCKED',
  'PLATFORM_MFA_ENROLLED',
  'PLATFORM_RECOVERY_USED',
  'PLATFORM_APPROVAL_REQUESTED',
  'PLATFORM_APPROVAL_GRANTED',
  'PLATFORM_APPROVAL_DENIED',
  'PLATFORM_OWNER_REPLACED',
  'PLATFORM_MFA_RESET',
  'PLATFORM_PASSWORD_RESET',
  'PLATFORM_SETTINGS_CHANGED',
];

export class PlatformIdentity1792000000000 implements MigrationInterface {
  name = 'PlatformIdentity1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const v of AUDIT_VALUES) {
      await queryRunner.query(
        `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE IF NOT EXISTS '${v}'`,
      );
    }

    await queryRunner.query(`
      CREATE TABLE "platform_admins" (
        "user_id" uuid NOT NULL,
        "locked_by" uuid,
        "locked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_admins" PRIMARY KEY ("user_id"),
        CONSTRAINT "FK_platform_admins_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_platform_admins_locked_by" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE RESTRICT
      )`);

    await queryRunner.query(`
      CREATE TABLE "user_mfa" (
        "user_id" uuid NOT NULL,
        "secret_enc" text NOT NULL,
        "confirmed_at" timestamptz,
        "last_step" bigint,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_mfa" PRIMARY KEY ("user_id"),
        CONSTRAINT "FK_user_mfa_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`);

    await queryRunner.query(`
      CREATE TABLE "user_recovery_codes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "code_hash" varchar(64) NOT NULL,
        "used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_recovery_codes" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_user_recovery_codes_hash_len" CHECK (length("code_hash") = 64),
        CONSTRAINT "FK_user_recovery_codes_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_user_recovery_codes_user_id" ON "user_recovery_codes" ("user_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "platform_admin_devices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "device_hash" varchar(64) NOT NULL,
        "label" varchar(120),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "last_seen_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_admin_devices" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_platform_admin_devices_user_device" UNIQUE ("user_id", "device_hash"),
        CONSTRAINT "FK_platform_admin_devices_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`);

    await queryRunner.query(`
      CREATE TABLE "platform_approvals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "scope" varchar(60) NOT NULL,
        "payload_hash" varchar(64) NOT NULL,
        "summary" jsonb NOT NULL,
        "requested_by" uuid NOT NULL,
        "status" varchar(12) NOT NULL DEFAULT 'PENDING',
        "decided_by" uuid,
        "decided_at" timestamptz,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_approvals" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_platform_approvals_status" CHECK ("status" IN ('PENDING', 'GRANTED', 'DENIED', 'USED', 'EXPIRED')),
        CONSTRAINT "FK_platform_approvals_requested_by" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_platform_approvals_decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_platform_approvals_status_expires" ON "platform_approvals" ("status", "expires_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "platform_settings" (
        "key" varchar(60) NOT NULL,
        "value" jsonb NOT NULL,
        "updated_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_settings" PRIMARY KEY ("key"),
        CONSTRAINT "FK_platform_settings_updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL
      )`);

    await queryRunner.query(
      `ALTER TABLE "schools" ADD COLUMN "is_platform" boolean NOT NULL DEFAULT false`,
    );
    // ((true)) indexes a constant: with the WHERE it allows at most one is_platform row.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_schools_one_platform" ON "schools" ((true)) WHERE "is_platform"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_schools_one_platform"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "is_platform"`);
    await queryRunner.query(`DROP TABLE "platform_settings"`);
    await queryRunner.query(`DROP TABLE "platform_approvals"`);
    await queryRunner.query(`DROP TABLE "platform_admin_devices"`);
    await queryRunner.query(`DROP TABLE "user_recovery_codes"`);
    await queryRunner.query(`DROP TABLE "user_mfa"`);
    await queryRunner.query(`DROP TABLE "platform_admins"`);

    // Postgres has no `DROP VALUE`: rebuild the enum without the 13 values, keeping every other
    // label in its current order. Fails loudly if an audit row still uses one of them.
    const rows: { enumlabel: string }[] = await queryRunner.query(
      `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.audit_logs_action_enum'::regtype ORDER BY enumsortorder`,
    );
    const keep = rows.map((r) => r.enumlabel).filter((l) => !AUDIT_VALUES.includes(l));
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_action_enum" AS ENUM(${keep.map((l) => `'${l}'`).join(', ')})`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::text::"public"."audit_logs_action_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
  }
}
