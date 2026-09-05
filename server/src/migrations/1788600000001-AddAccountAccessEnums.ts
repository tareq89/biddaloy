import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountAccessEnums1788600000001 implements MigrationInterface {
  name = 'AddAccountAccessEnums1788600000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."communication_logs_trigger_enum" ADD VALUE 'ACCOUNT_ACCESS'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'INVITATION_SENT'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'INVITATION_REVOKED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'ACCOUNT_ACTIVATED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no `ALTER TYPE ... DROP VALUE` — recreate both types
    // without the added values. Fails loudly (by design) if any row
    // already uses one of them: rolling back into data the old type can't
    // represent should error, not silently drop rows or truncate data.
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REUSE_DETECTED', 'PAYMENT_RECEIVED', 'INVOICE_GENERATED', 'BULK_UPLOAD', 'REMINDER_SENT', 'REMINDER_PREVIEWED', 'FEE_STRUCTURE_CHANGE', 'SETTINGS_CHANGE', 'SETTINGS_TEST')`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::text::"public"."audit_logs_action_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);

    await queryRunner.query(
      `ALTER TYPE "public"."communication_logs_trigger_enum" RENAME TO "communication_logs_trigger_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."communication_logs_trigger_enum" AS ENUM('MANUAL', 'AUTOMATED', 'BULK_REMINDER', 'SINGLE_REMINDER')`,
    );
    await queryRunner.query(
      `ALTER TABLE "communication_logs" ALTER COLUMN "trigger" TYPE "public"."communication_logs_trigger_enum" USING "trigger"::text::"public"."communication_logs_trigger_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."communication_logs_trigger_enum_old"`);
  }
}
