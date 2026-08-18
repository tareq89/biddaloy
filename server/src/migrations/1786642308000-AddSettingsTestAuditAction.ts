import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSettingsTestAuditAction1786642308000 implements MigrationInterface {
  name = 'AddSettingsTestAuditAction1786642308000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'SETTINGS_TEST'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no `ALTER TYPE ... DROP VALUE` — recreate the type
    // without it. Fails loudly (by design) if any audit_logs row already
    // uses 'SETTINGS_TEST': rolling back into data the old type can't
    // represent should error, not silently drop rows or truncate data.
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REUSE_DETECTED', 'PAYMENT_RECEIVED', 'INVOICE_GENERATED', 'BULK_UPLOAD', 'REMINDER_SENT', 'FEE_STRUCTURE_CHANGE', 'SETTINGS_CHANGE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::text::"public"."audit_logs_action_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
  }
}
