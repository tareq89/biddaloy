import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [29.0] A second partial unique index on `teacher_class_sections`.
 *
 * `UQ_tcs_teacher_section_no_subject` (from `AddSubjectsAndClassSubjects`)
 * stops the *same teacher* holding two class-teacher rows for one section.
 * It does not stop *two different teachers* both being the class-teacher
 * for the same section — that requires uniqueness on `section_id` alone
 * (still partial on `subject_id IS NULL`, since subject-teacher rows are
 * allowed to repeat per section for different subjects).
 */
export class AddTcsSectionNoSubjectUniqueIndex1790400000000 implements MigrationInterface {
  name = 'AddTcsSectionNoSubjectUniqueIndex1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tcs_section_no_subject" ON "teacher_class_sections" ("section_id") WHERE "subject_id" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_tcs_section_no_subject"`);
  }
}
