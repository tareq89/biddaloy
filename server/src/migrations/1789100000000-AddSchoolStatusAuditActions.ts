import { MigrationInterface, QueryRunner } from 'typeorm';

/** [15.4/#530] `SUSPEND`/`REACTIVATE` audit rows for `PATCH /schools/:id/status` —
 * see `schools.service.ts#updateStatus` for the write site. */
export class AddSchoolStatusAuditActions1789100000000 implements MigrationInterface {
  name = 'AddSchoolStatusAuditActions1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'SUSPEND'`);
    await queryRunner.query(`ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'REACTIVATE'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no `ALTER TYPE ... DROP VALUE` — recreate the type
    // without the added values, same shape as
    // AddSessionRevokedAuditAction1788900000000's down(). Fails loudly if
    // any audit_logs row already uses SUSPEND/REACTIVATE. The recreated
    // list must retain 'SESSION_REVOKED' (12.8) — dropping it here would
    // silently undo that migration's addition.
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REUSE_DETECTED', 'PAYMENT_RECEIVED', 'INVOICE_GENERATED', 'BULK_UPLOAD', 'REMINDER_SENT', 'REMINDER_PREVIEWED', 'FEE_STRUCTURE_CHANGE', 'SETTINGS_CHANGE', 'SETTINGS_TEST', 'INVITATION_SENT', 'INVITATION_REVOKED', 'ACCOUNT_ACTIVATED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET', 'CONTACT_VERIFIED', 'SESSION_REVOKED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::text::"public"."audit_logs_action_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
  }
}
