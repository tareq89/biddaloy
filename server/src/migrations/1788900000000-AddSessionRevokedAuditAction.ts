import { MigrationInterface, QueryRunner } from 'typeorm';

/** [12.8] One `SESSION_REVOKED` audit row per self-service session revoke —
 * see `auth.service.ts#revokeSession` for the write site. */
export class AddSessionRevokedAuditAction1788900000000 implements MigrationInterface {
  name = 'AddSessionRevokedAuditAction1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'SESSION_REVOKED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no `ALTER TYPE ... DROP VALUE` — recreate the type
    // without the added value, same shape as
    // AddContactVerifiedAuditAction1788800000001's down(). Fails loudly if
    // any audit_logs row already uses it. The recreated list must retain
    // 'CONTACT_VERIFIED' (12.7) — dropping it here would silently undo that
    // migration's addition.
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REUSE_DETECTED', 'PAYMENT_RECEIVED', 'INVOICE_GENERATED', 'BULK_UPLOAD', 'REMINDER_SENT', 'REMINDER_PREVIEWED', 'FEE_STRUCTURE_CHANGE', 'SETTINGS_CHANGE', 'SETTINGS_TEST', 'INVITATION_SENT', 'INVITATION_REVOKED', 'ACCOUNT_ACTIVATED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET', 'CONTACT_VERIFIED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::text::"public"."audit_logs_action_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
  }
}
