import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [19.2.1] Seven tenant-scoped tables for exams, marks and results:
 *
 * - `exams` — one sitting (e.g. "First Term Exam") for one class in one
 *   academic year. `kind` is a label only (D19) — no behaviour keys off
 *   it.
 * - `exam_components` — the markable parts of one exam-subject. No
 *   `weight` column (D16): every component contributes 1:1 to the
 *   subject total.
 * - `marks` — one student's value for one component. D10: `value` must
 *   be null unless `status = 'PRESENT'`, enforced here by a CHECK
 *   constraint so an `ABSENT` mark can never be read as a zero.
 * - `mark_grids` — D12's per-section-subject entry grid state
 *   (DRAFT/SUBMITTED).
 * - `results` — one student's computed result for one exam. Pins
 *   `grading_scale_id`, `grading_scale_revision` and `rule_version`
 *   (D19, and Epic 20.0's D6): once computed, a result records exactly
 *   which scale revision and rule engine version produced it, so a later
 *   edit to the scale cannot silently change what an already-printed
 *   card shows. Follows `1789800008000-InvoiceImmutableSnapshot.ts`'s
 *   pinning approach.
 * - `result_subjects` — a result's per-subject breakdown.
 * - `student_subject_choices` — D14's per-student fourth/optional
 *   subject choice. `academic_year_id` is denormalised from the chosen
 *   `class_subject.academic_year_id` (same reasoning as
 *   `AttendanceRecord.date` copying `session.date`) because the partial
 *   unique index enforcing "one `is_fourth = true` per student per year"
 *   needs that column on this table — an index cannot reach through a
 *   FK into another table.
 */
export class AddExamsMarksResults1789800012000 implements MigrationInterface {
  name = 'AddExamsMarksResults1789800012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // exams
    await queryRunner.query(
      `CREATE TYPE "public"."exams_kind_enum" AS ENUM('TERM', 'MONTHLY', 'MODEL', 'OTHER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."exams_status_enum" AS ENUM('DRAFT', 'PROCESSED', 'PUBLISHED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "exams" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "academic_year_id" uuid NOT NULL,
        "class_id" uuid NOT NULL,
        "academic_term_id" uuid,
        "name" varchar(200) NOT NULL,
        "kind" "public"."exams_kind_enum" NOT NULL,
        "status" "public"."exams_status_enum" NOT NULL DEFAULT 'DRAFT',
        "published_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_exams" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_exams_tenant_year_class" ON "exams" ("tenant_id", "academic_year_id", "class_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_exams_tenant_year_class_name" ON "exams" ("tenant_id", "academic_year_id", "class_id", "name") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "exams" ADD CONSTRAINT "FK_exams_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "exams" ADD CONSTRAINT "FK_exams_academic_year" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "exams" ADD CONSTRAINT "FK_exams_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "exams" ADD CONSTRAINT "FK_exams_academic_term" FOREIGN KEY ("academic_term_id") REFERENCES "academic_terms"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // exam_components
    await queryRunner.query(
      `CREATE TYPE "public"."exam_components_kind_enum" AS ENUM('WRITTEN', 'MCQ', 'VIVA', 'LAB', 'PRACTICAL', 'MONTHLY_TEST', 'ATTENDANCE', 'OTHER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."exam_components_source_enum" AS ENUM('MANUAL', 'DERIVED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "exam_components" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "exam_id" uuid NOT NULL,
        "subject_id" uuid NOT NULL,
        "name" varchar(200) NOT NULL,
        "kind" "public"."exam_components_kind_enum" NOT NULL,
        "source" "public"."exam_components_source_enum" NOT NULL DEFAULT 'MANUAL',
        "full_marks" numeric(6,2) NOT NULL,
        "pass_marks" numeric(6,2),
        "sequence" int NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_exam_components" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_exam_components_tenant_exam" ON "exam_components" ("tenant_id", "exam_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_exam_components_exam_subject_name" ON "exam_components" ("exam_id", "subject_id", "name") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "exam_components" ADD CONSTRAINT "FK_exam_components_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "exam_components" ADD CONSTRAINT "FK_exam_components_exam" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "exam_components" ADD CONSTRAINT "FK_exam_components_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // marks
    await queryRunner.query(
      `CREATE TYPE "public"."marks_status_enum" AS ENUM('PRESENT', 'ABSENT', 'EXEMPT')`,
    );
    await queryRunner.query(`
      CREATE TABLE "marks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "exam_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "subject_id" uuid NOT NULL,
        "component_id" uuid NOT NULL,
        "value" numeric(6,2),
        "status" "public"."marks_status_enum" NOT NULL,
        "entered_by" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marks" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_marks_value_only_when_present" CHECK ("status" = 'PRESENT' OR "value" IS NULL)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_marks_tenant_exam" ON "marks" ("tenant_id", "exam_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_marks_exam_student_component" ON "marks" ("exam_id", "student_id", "component_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "marks" ADD CONSTRAINT "FK_marks_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "marks" ADD CONSTRAINT "FK_marks_exam" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "marks" ADD CONSTRAINT "FK_marks_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "marks" ADD CONSTRAINT "FK_marks_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "marks" ADD CONSTRAINT "FK_marks_component" FOREIGN KEY ("component_id") REFERENCES "exam_components"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // mark_grids
    await queryRunner.query(
      `CREATE TYPE "public"."mark_grids_state_enum" AS ENUM('DRAFT', 'SUBMITTED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "mark_grids" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "exam_id" uuid NOT NULL,
        "section_id" uuid NOT NULL,
        "subject_id" uuid NOT NULL,
        "state" "public"."mark_grids_state_enum" NOT NULL DEFAULT 'DRAFT',
        "submitted_by" uuid,
        "submitted_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_mark_grids" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_mark_grids_tenant_exam" ON "mark_grids" ("tenant_id", "exam_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_mark_grids_exam_section_subject" ON "mark_grids" ("exam_id", "section_id", "subject_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "mark_grids" ADD CONSTRAINT "FK_mark_grids_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mark_grids" ADD CONSTRAINT "FK_mark_grids_exam" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mark_grids" ADD CONSTRAINT "FK_mark_grids_section" FOREIGN KEY ("section_id") REFERENCES "class_sections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mark_grids" ADD CONSTRAINT "FK_mark_grids_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // results
    await queryRunner.query(`
      CREATE TABLE "results" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "exam_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "total_marks" numeric(8,2) NOT NULL,
        "gpa" numeric(4,2) NOT NULL,
        "grade" varchar(10) NOT NULL,
        "position" int,
        "is_fail" boolean NOT NULL DEFAULT false,
        "grading_scale_id" uuid NOT NULL,
        "grading_scale_revision" int NOT NULL,
        "rule_version" varchar(50) NOT NULL,
        "computed_at" timestamptz NOT NULL,
        "published_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_results" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_results_tenant_exam" ON "results" ("tenant_id", "exam_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_results_exam_student" ON "results" ("exam_id", "student_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "results" ADD CONSTRAINT "FK_results_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "results" ADD CONSTRAINT "FK_results_exam" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "results" ADD CONSTRAINT "FK_results_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "results" ADD CONSTRAINT "FK_results_grading_scale" FOREIGN KEY ("grading_scale_id") REFERENCES "grading_scales"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // result_subjects
    await queryRunner.query(`
      CREATE TABLE "result_subjects" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "result_id" uuid NOT NULL,
        "subject_id" uuid NOT NULL,
        "obtained" numeric(6,2) NOT NULL,
        "grade" varchar(10) NOT NULL,
        "gpa" numeric(4,2) NOT NULL,
        "is_fail" boolean NOT NULL DEFAULT false,
        "is_fourth_subject" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_result_subjects" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_result_subjects_tenant_result" ON "result_subjects" ("tenant_id", "result_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_result_subjects_result_subject" ON "result_subjects" ("result_id", "subject_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "result_subjects" ADD CONSTRAINT "FK_result_subjects_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "result_subjects" ADD CONSTRAINT "FK_result_subjects_result" FOREIGN KEY ("result_id") REFERENCES "results"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "result_subjects" ADD CONSTRAINT "FK_result_subjects_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // student_subject_choices
    await queryRunner.query(`
      CREATE TABLE "student_subject_choices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "class_subject_id" uuid NOT NULL,
        "academic_year_id" uuid NOT NULL,
        "is_fourth" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_student_subject_choices" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_student_subject_choices_tenant_student" ON "student_subject_choices" ("tenant_id", "student_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_student_subject_choices_student_class_subject" ON "student_subject_choices" ("student_id", "class_subject_id")`,
    );
    // D14: at most one fourth-subject choice per student per academic year.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_student_subject_choices_one_fourth_per_year" ON "student_subject_choices" ("student_id", "academic_year_id") WHERE "is_fourth" = true`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_choices" ADD CONSTRAINT "FK_student_subject_choices_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_choices" ADD CONSTRAINT "FK_student_subject_choices_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_choices" ADD CONSTRAINT "FK_student_subject_choices_class_subject" FOREIGN KEY ("class_subject_id") REFERENCES "class_subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_choices" ADD CONSTRAINT "FK_student_subject_choices_academic_year" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // student_subject_choices
    await queryRunner.query(
      `ALTER TABLE "student_subject_choices" DROP CONSTRAINT "FK_student_subject_choices_academic_year"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_choices" DROP CONSTRAINT "FK_student_subject_choices_class_subject"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_choices" DROP CONSTRAINT "FK_student_subject_choices_student"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_choices" DROP CONSTRAINT "FK_student_subject_choices_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "student_subject_choices"`);

    // result_subjects
    await queryRunner.query(
      `ALTER TABLE "result_subjects" DROP CONSTRAINT "FK_result_subjects_subject"`,
    );
    await queryRunner.query(
      `ALTER TABLE "result_subjects" DROP CONSTRAINT "FK_result_subjects_result"`,
    );
    await queryRunner.query(
      `ALTER TABLE "result_subjects" DROP CONSTRAINT "FK_result_subjects_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "result_subjects"`);

    // results
    await queryRunner.query(`ALTER TABLE "results" DROP CONSTRAINT "FK_results_grading_scale"`);
    await queryRunner.query(`ALTER TABLE "results" DROP CONSTRAINT "FK_results_student"`);
    await queryRunner.query(`ALTER TABLE "results" DROP CONSTRAINT "FK_results_exam"`);
    await queryRunner.query(`ALTER TABLE "results" DROP CONSTRAINT "FK_results_tenant"`);
    await queryRunner.query(`DROP TABLE "results"`);

    // mark_grids
    await queryRunner.query(`ALTER TABLE "mark_grids" DROP CONSTRAINT "FK_mark_grids_subject"`);
    await queryRunner.query(`ALTER TABLE "mark_grids" DROP CONSTRAINT "FK_mark_grids_section"`);
    await queryRunner.query(`ALTER TABLE "mark_grids" DROP CONSTRAINT "FK_mark_grids_exam"`);
    await queryRunner.query(`ALTER TABLE "mark_grids" DROP CONSTRAINT "FK_mark_grids_tenant"`);
    await queryRunner.query(`DROP TABLE "mark_grids"`);
    await queryRunner.query(`DROP TYPE "public"."mark_grids_state_enum"`);

    // marks
    await queryRunner.query(`ALTER TABLE "marks" DROP CONSTRAINT "FK_marks_component"`);
    await queryRunner.query(`ALTER TABLE "marks" DROP CONSTRAINT "FK_marks_subject"`);
    await queryRunner.query(`ALTER TABLE "marks" DROP CONSTRAINT "FK_marks_student"`);
    await queryRunner.query(`ALTER TABLE "marks" DROP CONSTRAINT "FK_marks_exam"`);
    await queryRunner.query(`ALTER TABLE "marks" DROP CONSTRAINT "FK_marks_tenant"`);
    await queryRunner.query(`DROP TABLE "marks"`);
    await queryRunner.query(`DROP TYPE "public"."marks_status_enum"`);

    // exam_components
    await queryRunner.query(
      `ALTER TABLE "exam_components" DROP CONSTRAINT "FK_exam_components_subject"`,
    );
    await queryRunner.query(
      `ALTER TABLE "exam_components" DROP CONSTRAINT "FK_exam_components_exam"`,
    );
    await queryRunner.query(
      `ALTER TABLE "exam_components" DROP CONSTRAINT "FK_exam_components_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "exam_components"`);
    await queryRunner.query(`DROP TYPE "public"."exam_components_source_enum"`);
    await queryRunner.query(`DROP TYPE "public"."exam_components_kind_enum"`);

    // exams
    await queryRunner.query(`ALTER TABLE "exams" DROP CONSTRAINT "FK_exams_academic_term"`);
    await queryRunner.query(`ALTER TABLE "exams" DROP CONSTRAINT "FK_exams_class"`);
    await queryRunner.query(`ALTER TABLE "exams" DROP CONSTRAINT "FK_exams_academic_year"`);
    await queryRunner.query(`ALTER TABLE "exams" DROP CONSTRAINT "FK_exams_tenant"`);
    await queryRunner.query(`DROP TABLE "exams"`);
    await queryRunner.query(`DROP TYPE "public"."exams_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."exams_kind_enum"`);
  }
}
