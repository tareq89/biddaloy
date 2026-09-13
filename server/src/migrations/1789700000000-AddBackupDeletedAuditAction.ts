import { MigrationInterface, QueryRunner } from 'typeorm';

/** [14.12.2] `BACKUP_DELETED` — fired when retention prunes a backup/
 * workbook artefact (expiry, per-source count cap, snapshot age, or the
 * per-tenant storage cap). See `shared/src/enums/index.ts`'s `AuditAction`
 * doc comment on this member. Never fired for a `pinned` row. */
export class AddBackupDeletedAuditAction1789700000000 implements MigrationInterface {
  name = 'AddBackupDeletedAuditAction1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'BACKUP_DELETED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no `ALTER TYPE ... DROP VALUE` — recreate the type
    // without the added value, same shape as
    // AddSchoolStatusAuditActions1789100000000's down(). Fails loudly if
    // any audit_logs row already uses BACKUP_DELETED.
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REUSE_DETECTED', 'PAYMENT_RECEIVED', 'INVOICE_GENERATED', 'BULK_UPLOAD', 'REMINDER_SENT', 'REMINDER_PREVIEWED', 'FEE_STRUCTURE_CHANGE', 'SETTINGS_CHANGE', 'SETTINGS_TEST', 'INVITATION_SENT', 'INVITATION_REVOKED', 'ACCOUNT_ACTIVATED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET', 'CONTACT_VERIFIED', 'SESSION_REVOKED', 'SUSPEND', 'REACTIVATE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::text::"public"."audit_logs_action_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
  }
}
