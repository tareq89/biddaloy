import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [788, #1020] Backfills a matching ACTIVE `Enrollment` row for every ACTIVE
 * `Student` that doesn't have one. #994's reviewer found exam cohort
 * resolution depends on `Enrollment` being complete, but nothing guaranteed
 * that — `create()` always wrote one, but older rows (pre-dating that write,
 * or created by a path that skipped it) can still be missing it.
 *
 * `student_id`/`class_id` (via the student's `class_section_id` →
 * `class_sections.class_id`)/`section_id`/`academic_year_id` (via
 * `classes.academic_year_id`) are backfilled from the student's own current
 * section. Students with no `class_section_id`, or whose section/class is
 * soft-deleted or belongs to another tenant, are skipped (the joins require
 * a live, same-tenant section and class).
 *
 * `ON CONFLICT DO NOTHING` against the existing partial unique index
 * `IDX_enr_active_student_year` (`student_id`, `academic_year_id` WHERE
 * `enrollment_status = 'ACTIVE'`) makes a second run a no-op.
 */
export class BackfillMissingEnrollments1789800015000 implements MigrationInterface {
  name = 'BackfillMissingEnrollments1789800015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const result = await queryRunner.query(`
      INSERT INTO "enrollments"
        ("student_id", "class_id", "section_id", "academic_year_id", "tenant_id", "enrollment_status", "enrolled_at")
      SELECT
        s."id",
        cs."class_id",
        s."class_section_id",
        c."academic_year_id",
        s."tenant_id",
        'ACTIVE',
        now()
      FROM "students" s
      JOIN "class_sections" cs ON cs."id" = s."class_section_id" AND cs."tenant_id" = s."tenant_id" AND cs."deleted_at" IS NULL
      JOIN "classes" c ON c."id" = cs."class_id" AND c."tenant_id" = s."tenant_id" AND c."deleted_at" IS NULL
      WHERE s."deleted_at" IS NULL
        AND s."enrollment_status" = 'ACTIVE'
        AND s."class_section_id" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "enrollments" e
          WHERE e."student_id" = s."id"
            AND e."academic_year_id" = c."academic_year_id"
            AND e."enrollment_status" = 'ACTIVE'
        )
      ON CONFLICT DO NOTHING
      RETURNING "id"
    `);
    // `result` is `[rows[], rowCount]` for a `RETURNING` query on the pg
    // driver — take the row count from it rather than the array itself.
    const inserted = Array.isArray(result) ? (result[0]?.length ?? result.length) : 'unknown';
    // eslint-disable-next-line no-console
    console.log(`[BackfillMissingEnrollments] inserted ${inserted} enrollment row(s).`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Deliberate no-op: these rows are a correctness backfill, not a schema
    // change. Undoing it would re-introduce the exact gap this migration
    // closes (#994's reviewer finding) — a student with no `Enrollment` row
    // for their current class/section/year. Nothing to roll back.
  }
}
