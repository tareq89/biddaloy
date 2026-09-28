import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [38.1.2]/#1110 — `FINE` fee type + `FINE_RULE` generation source (values
 * added to the existing DB enums, cloning `AddLateFeeTypeEnumValue`'s
 * pattern), the `fine_rules` table (a school's standing fine policy per
 * `FineTrigger`), and three new `student_fees` columns that only a FINE
 * bill ever populates (D2, D22).
 */
export class Fines1790600000000 implements MigrationInterface {
  name = 'Fines1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."fee_structures_fee_type_enum" ADD VALUE IF NOT EXISTS 'FINE'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."fee_generations_source_enum" ADD VALUE IF NOT EXISTS 'FINE_RULE'`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."fine_rules_trigger_enum" AS ENUM('ATTENDANCE_ABSENT', 'ATTENDANCE_LATE')`,
    );
    await queryRunner.query(`
      CREATE TABLE "fine_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "academic_year_id" uuid NOT NULL,
        "trigger" "public"."fine_rules_trigger_enum" NOT NULL,
        "fee_structure_id" uuid NOT NULL,
        "class_id" uuid,
        "free_per_period" integer NOT NULL DEFAULT 0,
        "cap_per_period" decimal(10,2),
        "conditions" jsonb NOT NULL DEFAULT '{}',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_fine_rules" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fine_rules_free_per_period" CHECK ("free_per_period" >= 0),
        CONSTRAINT "CHK_fine_rules_cap_per_period" CHECK ("cap_per_period" IS NULL OR "cap_per_period" > 0)
      )
    `);
    // D22: `NULLS NOT DISTINCT` so two active rules for the same
    // (tenant, year, trigger, NULL class) collide instead of silently
    // coexisting — the same reasoning as Epic 33's org-structure migration
    // (1789800010700-AddOrganisationDimensions.ts).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_fine_rules_tenant_year_trigger_class"
        ON "fine_rules" ("tenant_id", "academic_year_id", "trigger", "class_id")
        NULLS NOT DISTINCT
        WHERE "deleted_at" IS NULL AND "is_active"
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_fine_rules_tenant_year" ON "fine_rules" ("tenant_id", "academic_year_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "fine_rules" ADD CONSTRAINT "FK_fine_rules_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fine_rules" ADD CONSTRAINT "FK_fine_rules_academic_year" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fine_rules" ADD CONSTRAINT "FK_fine_rules_fee_structure" FOREIGN KEY ("fee_structure_id") REFERENCES "fee_structures"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fine_rules" ADD CONSTRAINT "FK_fine_rules_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`ALTER TABLE "student_fees" ADD "note" character varying(280)`);
    await queryRunner.query(`ALTER TABLE "student_fees" ADD "incident_date" date`);
    await queryRunner.query(`ALTER TABLE "student_fees" ADD "fine_rule_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_student_fees_fine_rule_id" ON "student_fees" ("fine_rule_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "FK_student_fees_fine_rule" FOREIGN KEY ("fine_rule_id") REFERENCES "fine_rules"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "student_fees" DROP CONSTRAINT "FK_student_fees_fine_rule"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_student_fees_fine_rule_id"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "fine_rule_id"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "incident_date"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "note"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "fine_rules"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."fine_rules_trigger_enum"`);

    // Postgres cannot drop a single enum value; `FINE`/`FINE_RULE` stay in
    // their DB enums permanently, same convention as
    // AddLateFeeTypeEnumValue1789800009500 — documented no-op.
  }
}
