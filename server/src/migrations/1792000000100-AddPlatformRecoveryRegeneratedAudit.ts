import { MigrationInterface, QueryRunner } from 'typeorm';

/** [Epic 98 #4070] `PLATFORM_RECOVERY_REGENERATED`: an owner regenerated their recovery codes. */
export class AddPlatformRecoveryRegeneratedAudit1792000000100 implements MigrationInterface {
  name = 'AddPlatformRecoveryRegeneratedAudit1792000000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const label of ['PLATFORM_RECOVERY_REGENERATED']) {
      await queryRunner.query(
        `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE IF NOT EXISTS '${label}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no `ALTER TYPE ... DROP VALUE`: recreate the type without the label.
    // Rows already written with the removed label fall back to the generic UPDATE action, mapped
    // inside the column conversion below: `audit_logs` has a BEFORE UPDATE OR DELETE row trigger
    // (`trg_audit_logs_write_only`), so a plain UPDATE would fail, while ALTER COLUMN ... TYPE
    // rewrites the table without firing row triggers. The audit payload is kept.
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`,
    );
    await queryRunner.query(`DO $$
      DECLARE labels text;
      BEGIN
        SELECT string_agg(quote_literal(enumlabel), ', ' ORDER BY enumsortorder) INTO labels
          FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'audit_logs_action_enum_old'
            AND enumlabel NOT IN ('PLATFORM_RECOVERY_REGENERATED');
        EXECUTE 'CREATE TYPE "public"."audit_logs_action_enum" AS ENUM(' || labels || ')';
      END $$`);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING (CASE WHEN "action"::text IN ('PLATFORM_RECOVERY_REGENERATED') THEN 'UPDATE' ELSE "action"::text END)::"public"."audit_logs_action_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
  }
}
