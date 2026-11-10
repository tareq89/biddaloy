import { MigrationInterface, QueryRunner } from 'typeorm';

/** [69.2.01] `YEAR_CLOSE`, `YEAR_REOPEN`, `YEAR_ROLLOVER` audit actions (D21). Wave 1 added the
 * enum members in `shared` but no DB label, so the first rollover audit write failed. */
export class AddYearAuditActions1791900003800 implements MigrationInterface {
  name = 'AddYearAuditActions1791900003800';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const label of ['YEAR_CLOSE', 'YEAR_REOPEN', 'YEAR_ROLLOVER']) {
      await queryRunner.query(
        `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE IF NOT EXISTS '${label}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no `ALTER TYPE ... DROP VALUE`: recreate the type without the three labels.
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`,
    );
    await queryRunner.query(`DO $$
      DECLARE labels text;
      BEGIN
        SELECT string_agg(quote_literal(enumlabel), ', ' ORDER BY enumsortorder) INTO labels
          FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'audit_logs_action_enum_old'
            AND enumlabel NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN', 'YEAR_ROLLOVER');
        EXECUTE 'CREATE TYPE "public"."audit_logs_action_enum" AS ENUM(' || labels || ')';
      END $$`);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::text::"public"."audit_logs_action_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
  }
}
