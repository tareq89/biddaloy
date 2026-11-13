import { MigrationInterface, QueryRunner } from 'typeorm';

const VALUES = [
  'MODULES_UPDATED',
  'WORDS_UPDATED',
  'INSTITUTION_KIND_APPLIED',
  'PLATFORM_MODULES_UPDATED',
  'PLATFORM_MODULE_LOCK_UPDATED',
];

/** [77.1.02] Epic 77 audit actions. See `AuditAction` in `shared/src/enums/index.ts`. */
export class AddEpic77AuditActions1792200000000 implements MigrationInterface {
  name = 'AddEpic77AuditActions1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const v of VALUES) {
      await queryRunner.query(
        `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE IF NOT EXISTS '${v}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No `DROP VALUE` in Postgres: recreate the type minus these labels. Fails loudly if a row uses one.
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`,
    );
    const list = VALUES.map((v) => `'${v}'`).join(', ');
    await queryRunner.query(`DO $$
      DECLARE labels text;
      BEGIN
        SELECT string_agg(quote_literal(enumlabel), ', ' ORDER BY enumsortorder) INTO labels
          FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'audit_logs_action_enum_old' AND enumlabel NOT IN (${list});
        EXECUTE 'CREATE TYPE "public"."audit_logs_action_enum" AS ENUM(' || labels || ')';
      END $$`);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::text::"public"."audit_logs_action_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
  }
}
