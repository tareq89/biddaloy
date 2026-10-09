import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [66.1.02/#2000] `study_plans`, `lesson_deliveries`, `study_plan_templates`
 * and the two `lesson_deliveries_*` enums. The uniqueness and CHECK rules
 * (one live plan per scope, one delivery per section/date/period, reason iff
 * NOT_TAUGHT, no extra NOT_TAUGHT) live here so a service bug cannot break them.
 * Enum values mirror `shared/src/enums/study-plans.ts`.
 */
export class StudyPlans1791500000000 implements MigrationInterface {
  name = 'StudyPlans1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."lesson_deliveries_status_enum" AS ENUM('TAUGHT', 'PARTLY', 'NOT_TAUGHT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."lesson_deliveries_reason_enum" AS ENUM('TEACHER_ABSENT', 'SCHOOL_CLOSED', 'EXAM', 'ON_LEAVE', 'CANCELLED', 'OTHER')`,
    );

    await queryRunner.query(`
      CREATE TABLE "study_plans" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "academic_year_id" uuid NOT NULL,
        "academic_term_id" uuid,
        "section_id" uuid NOT NULL,
        "subject_id" uuid NOT NULL,
        "owner_override_teacher_id" uuid,
        "lessons" jsonb NOT NULL DEFAULT '[]',
        "exam_markers" jsonb NOT NULL DEFAULT '[]',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_study_plans" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_study_plans_json" CHECK (jsonb_typeof("lessons") = 'array' AND jsonb_typeof("exam_markers") = 'array')
      )
    `);
    // NULLS NOT DISTINCT (PG15+): a NULL term (whole year, D14) still collides.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_study_plans_scope" ON "study_plans" ("tenant_id", "section_id", "subject_id", "academic_term_id") NULLS NOT DISTINCT WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_study_plans_tenant_year" ON "study_plans" ("tenant_id", "academic_year_id")`,
    );
    const planFks: Array<[string, string, string, string]> = [
      ['tenant', 'tenant_id', 'schools', 'CASCADE'],
      ['section', 'section_id', 'class_sections', 'CASCADE'],
      ['subject', 'subject_id', 'subjects', 'CASCADE'],
      ['year', 'academic_year_id', 'academic_years', 'CASCADE'],
      ['term', 'academic_term_id', 'academic_terms', 'CASCADE'],
      ['owner', 'owner_override_teacher_id', 'teachers', 'SET NULL'],
    ];
    for (const [short, col, table, onDelete] of planFks) {
      await queryRunner.query(
        `ALTER TABLE "study_plans" ADD CONSTRAINT "FK_study_plans_${short}" FOREIGN KEY ("${col}") REFERENCES "${table}"("id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
      );
    }

    await queryRunner.query(`
      CREATE TABLE "lesson_deliveries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "section_id" uuid NOT NULL,
        "subject_id" uuid NOT NULL,
        "date" date NOT NULL,
        "period_slot_id" uuid NOT NULL,
        "status" "public"."lesson_deliveries_status_enum" NOT NULL,
        "reason" "public"."lesson_deliveries_reason_enum",
        "note" varchar(500),
        "is_extra" boolean NOT NULL DEFAULT false,
        "auto" boolean NOT NULL DEFAULT false,
        "recorded_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lesson_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_lesson_deliveries_slot" UNIQUE ("tenant_id", "section_id", "date", "period_slot_id"),
        CONSTRAINT "CHK_lesson_deliveries_reason" CHECK (("status" = 'NOT_TAUGHT') = ("reason" IS NOT NULL)),
        CONSTRAINT "CHK_lesson_deliveries_extra" CHECK (NOT "is_extra" OR "status" <> 'NOT_TAUGHT')
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_lesson_deliveries_plan_scope" ON "lesson_deliveries" ("tenant_id", "section_id", "subject_id", "date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_lesson_deliveries_tenant_date" ON "lesson_deliveries" ("tenant_id", "date")`,
    );
    const deliveryFks: Array<[string, string, string, string]> = [
      ['tenant', 'tenant_id', 'schools', 'CASCADE'],
      ['section', 'section_id', 'class_sections', 'CASCADE'],
      ['subject', 'subject_id', 'subjects', 'CASCADE'],
      // RESTRICT: a delivery is teaching history. Replacing a shift's period
      // set must not silently wipe it (`PeriodSlotsService` refuses with 409).
      ['period_slot', 'period_slot_id', 'period_slots', 'RESTRICT'],
      ['recorded_by', 'recorded_by_user_id', 'users', 'SET NULL'],
    ];
    for (const [short, col, table, onDelete] of deliveryFks) {
      await queryRunner.query(
        `ALTER TABLE "lesson_deliveries" ADD CONSTRAINT "FK_lesson_deliveries_${short}" FOREIGN KEY ("${col}") REFERENCES "${table}"("id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
      );
    }

    await queryRunner.query(`
      CREATE TABLE "study_plan_templates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(200) NOT NULL,
        "class_grade" int NOT NULL,
        "subject_code" varchar(20) NOT NULL,
        "lessons" jsonb NOT NULL DEFAULT '[]',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_study_plan_templates" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_study_plan_templates_json" CHECK (jsonb_typeof("lessons") = 'array')
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_study_plan_templates_name" ON "study_plan_templates" ("tenant_id", "name") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_study_plan_templates_key" ON "study_plan_templates" ("tenant_id", "class_grade", "subject_code")`,
    );
    await queryRunner.query(
      `ALTER TABLE "study_plan_templates" ADD CONSTRAINT "FK_study_plan_templates_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "study_plan_templates"`);
    await queryRunner.query(`DROP TABLE "lesson_deliveries"`);
    await queryRunner.query(`DROP TABLE "study_plans"`);
    await queryRunner.query(`DROP TYPE "public"."lesson_deliveries_reason_enum"`);
    await queryRunner.query(`DROP TYPE "public"."lesson_deliveries_status_enum"`);
  }
}
