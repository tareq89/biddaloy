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
    // [pr-fix #1035] `POST/PATCH /teachers` (`UserService.createTeacher`/
    // `updateTeacher`) and the workbook teacher-assignments import can
    // both insert a second `subject_id IS NULL` row for one section
    // without going through `SectionService.assignTeacher`'s D3
    // auto-replace — so on a school with existing data, the CREATE INDEX
    // below can fail outright. Abort with a clear, actionable error rather
    // than silently deleting what may be a real access grant (these rows
    // gate attendance/homework/marks access) — "keep the latest" is an
    // arbitrary rule to apply to someone else's data. See #1048 for the
    // follow-up making the write paths themselves reject duplicates
    // cleanly instead of relying on this index to catch them.
    const duplicates: Array<{ section_id: string; n: string }> = await queryRunner.query(
      `SELECT "section_id", COUNT(*)::int AS n
       FROM "teacher_class_sections"
       WHERE "subject_id" IS NULL
       GROUP BY "section_id"
       HAVING COUNT(*) > 1`,
    );
    if (duplicates.length > 0) {
      const sectionIds = duplicates.map((d) => d.section_id).join(', ');
      throw new Error(
        `AddTcsSectionNoSubjectUniqueIndex1790400000000: cannot create ` +
          `UQ_tcs_section_no_subject — ${duplicates.length} section(s) already ` +
          `have more than one class-teacher row (subject_id IS NULL): ${sectionIds}. ` +
          `Reassign or remove the extra class-teacher row(s) for these sections ` +
          `(or convert them to subject-teacher rows) before re-running this migration.`,
      );
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tcs_section_no_subject" ON "teacher_class_sections" ("section_id") WHERE "subject_id" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_tcs_section_no_subject"`);
  }
}
