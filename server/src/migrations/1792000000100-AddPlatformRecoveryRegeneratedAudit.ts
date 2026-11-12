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
    // Rows already written with a removed label would make the cast below fail, so they fall back
    // to the generic UPDATE action (their audit payload is kept).
    await queryRunner.query(
      `UPDATE "audit_logs" SET "action" = 'UPDATE' WHERE "action" IN ('PLATFORM_RECOVERY_REGENERATED')`,
    );
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
      `ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::text::"public"."audit_logs_action_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
  }
}
