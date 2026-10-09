import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [47.1.1] `teacher_class_sections.assignment_type` (47.0 D2/D9/D20/D28/D30).
 *
 * Replaces "subject_id IS NULL means class teacher" with an explicit enum:
 * CLASS_TEACHER (one per section), ASSISTANT_CLASS_TEACHER (many), and
 * SUBJECT_TEACHER (needs a subject). A BEFORE INSERT trigger infers the type
 * from `subject_id` when an insert omits it, so legacy raw INSERTs keep working.
 */
export class TeacherAssignmentType1791300000000 implements MigrationInterface {
  name = 'TeacherAssignmentType1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "teacher_assignment_type" AS ENUM ('CLASS_TEACHER','ASSISTANT_CLASS_TEACHER','SUBJECT_TEACHER')`,
    );
    await queryRunner.query(
      `ALTER TABLE "teacher_class_sections" ADD COLUMN "assignment_type" "teacher_assignment_type"`,
    );
    // Safe: UQ_tcs_section_no_subject + UQ_tcs_teacher_section_no_subject already
    // guarantee at most one NULL-subject row per section and per teacher-section.
    await queryRunner.query(
      `UPDATE "teacher_class_sections" SET "assignment_type" = CASE WHEN "subject_id" IS NULL THEN 'CLASS_TEACHER'::teacher_assignment_type ELSE 'SUBJECT_TEACHER'::teacher_assignment_type END`,
    );
    await queryRunner.query(
      `ALTER TABLE "teacher_class_sections" ALTER COLUMN "assignment_type" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "teacher_class_sections" ADD CONSTRAINT "CK_tcs_subject_matches_type" CHECK (("assignment_type" = 'SUBJECT_TEACHER') = ("subject_id" IS NOT NULL))`,
    );
    await queryRunner.query(`DROP INDEX "UQ_tcs_section_no_subject"`);
    await queryRunner.query(`DROP INDEX "UQ_tcs_teacher_section_no_subject"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tcs_section_class_teacher" ON "teacher_class_sections" ("section_id") WHERE "assignment_type" = 'CLASS_TEACHER'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tcs_teacher_section_homeroom" ON "teacher_class_sections" ("teacher_id", "section_id") WHERE "assignment_type" IN ('CLASS_TEACHER','ASSISTANT_CLASS_TEACHER')`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "tcs_default_assignment_type"() RETURNS trigger AS $$
      BEGIN
        IF NEW."assignment_type" IS NULL THEN
          NEW."assignment_type" := CASE WHEN NEW."subject_id" IS NULL
            THEN 'CLASS_TEACHER'::teacher_assignment_type
            ELSE 'SUBJECT_TEACHER'::teacher_assignment_type END;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `CREATE TRIGGER "TRG_tcs_default_assignment_type" BEFORE INSERT ON "teacher_class_sections" FOR EACH ROW EXECUTE FUNCTION "tcs_default_assignment_type"()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Never delete assistants: the old schema cannot represent them.
    const assistants: Array<{ n: number }> = await queryRunner.query(
      `SELECT COUNT(*)::int AS n FROM "teacher_class_sections" WHERE "assignment_type" = 'ASSISTANT_CLASS_TEACHER'`,
    );
    if (assistants[0].n > 0) {
      throw new Error(
        `TeacherAssignmentType1791300000000: cannot revert — ${assistants[0].n} ` +
          `ASSISTANT_CLASS_TEACHER row(s) exist and the old schema cannot represent them. ` +
          `Remove or convert them to SUBJECT_TEACHER rows before reverting.`,
      );
    }
    await queryRunner.query(
      `DROP TRIGGER "TRG_tcs_default_assignment_type" ON "teacher_class_sections"`,
    );
    await queryRunner.query(`DROP FUNCTION "tcs_default_assignment_type"()`);
    await queryRunner.query(`DROP INDEX "UQ_tcs_teacher_section_homeroom"`);
    await queryRunner.query(`DROP INDEX "UQ_tcs_section_class_teacher"`);
    await queryRunner.query(
      `ALTER TABLE "teacher_class_sections" DROP CONSTRAINT "CK_tcs_subject_matches_type"`,
    );
    await queryRunner.query(`ALTER TABLE "teacher_class_sections" DROP COLUMN "assignment_type"`);
    await queryRunner.query(`DROP TYPE "teacher_assignment_type"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tcs_section_no_subject" ON "teacher_class_sections" ("section_id") WHERE "subject_id" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tcs_teacher_section_no_subject" ON "teacher_class_sections" ("teacher_id", "section_id") WHERE "subject_id" IS NULL`,
    );
  }
}
