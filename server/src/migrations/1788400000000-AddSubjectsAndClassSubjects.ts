import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [9.1] Adds `subjects` and `class_subjects`, and fixes a pre-existing
 * tenancy gap on `teacher_class_sections` (no direct `tenant_id`) while
 * touching that table for its new `subject_id` column.
 *
 * Order: create the two new tables first, then alter
 * `teacher_class_sections` — `tenant_id` is backfilled from the section it
 * points at (`class_sections.tenant_id`), then made `NOT NULL`. If any row
 * is left with a `NULL` `tenant_id` after the backfill (an orphaned
 * `section_id`), the `SET NOT NULL` step below fails loudly rather than
 * silently dropping or defaulting that row — that would be data
 * corruption this migration must not paper over.
 */
export class AddSubjectsAndClassSubjects1788400000000 implements MigrationInterface {
  name = 'AddSubjectsAndClassSubjects1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. subjects
    await queryRunner.query(`
      CREATE TABLE "subjects" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name_en" varchar(100) NOT NULL,
        "name_bn" varchar(100),
        "code" varchar(20) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_subjects" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subjects_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_subjects_tenant_id" ON "subjects" ("tenant_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_subjects_tenant_code" ON "subjects" ("tenant_id", "code") WHERE "deleted_at" IS NULL`,
    );

    // 2. class_subjects
    await queryRunner.query(`
      CREATE TABLE "class_subjects" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "class_id" uuid NOT NULL,
        "subject_id" uuid NOT NULL,
        "academic_year_id" uuid NOT NULL,
        "is_optional" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_class_subjects" PRIMARY KEY ("id"),
        CONSTRAINT "FK_class_subjects_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_class_subjects_class" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_class_subjects_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_class_subjects_academic_year" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_class_subjects_tenant_year" ON "class_subjects" ("tenant_id", "academic_year_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_class_subjects_class_subject_year" ON "class_subjects" ("class_id", "subject_id", "academic_year_id") WHERE "deleted_at" IS NULL`,
    );

    // 3. teacher_class_sections.tenant_id — add, backfill, then enforce NOT NULL.
    await queryRunner.query(`ALTER TABLE "teacher_class_sections" ADD COLUMN "tenant_id" uuid`);
    await queryRunner.query(`
      UPDATE "teacher_class_sections" tcs
      SET "tenant_id" = cs."tenant_id"
      FROM "class_sections" cs
      WHERE cs."id" = tcs."section_id"
    `);

    const orphaned = await queryRunner.query(
      `SELECT count(*)::int AS count FROM "teacher_class_sections" WHERE "tenant_id" IS NULL`,
    );
    if (orphaned[0]?.count > 0) {
      throw new Error(
        `AddSubjectsAndClassSubjects: ${orphaned[0].count} teacher_class_sections row(s) ` +
          `have a section_id that does not resolve to a class_sections row — the tenant_id ` +
          `backfill cannot proceed. This is data corruption; fix or remove those rows before ` +
          `re-running this migration.`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "teacher_class_sections" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "teacher_class_sections"
      ADD CONSTRAINT "FK_teacher_class_sections_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_teacher_class_sections_tenant_id" ON "teacher_class_sections" ("tenant_id")`,
    );

    // 4. teacher_class_sections.subject_id — nullable, FK to subjects with SET NULL.
    await queryRunner.query(
      `ALTER TABLE "teacher_class_sections" ADD COLUMN "subject_id" uuid NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "teacher_class_sections"
      ADD CONSTRAINT "FK_teacher_class_sections_subject" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL
    `);

    // 5. Replace the old (teacher_id, section_id) unique index with one
    // that includes subject_id, plus a partial index covering the
    // subject_id IS NULL case (see teacher-class-section.entity.ts's
    // docstring for why Postgres needs both).
    //
    // The original `(teacher_id, section_id)` uniqueness is a plain
    // UNIQUE INDEX, not a table CONSTRAINT — `1784175065080-
    // AddTenantIsolationAndEnrollments` created it as
    // `CREATE UNIQUE INDEX "IDX_tcs_teacher_section" ON
    // "teacher_class_sections" ("teacher_id", "section_id")`, not
    // `ADD CONSTRAINT ... UNIQUE`, so it does not show up in
    // `pg_constraint` at all (confirmed against the live schema —
    // `SELECT conname FROM pg_constraint WHERE conrelid =
    // 'teacher_class_sections'::regclass AND contype = 'u'` returns no
    // rows). Verify the expected index exists before dropping it, so an
    // unexpected schema still fails loudly instead of silently no-op'ing.
    const [oldIndex] = await queryRunner.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'teacher_class_sections' AND indexname = 'IDX_tcs_teacher_section'
    `);
    if (!oldIndex) {
      throw new Error(
        'AddSubjectsAndClassSubjects: expected unique index ' +
          '"IDX_tcs_teacher_section" on teacher_class_sections(teacher_id, section_id) ' +
          'but found none.',
      );
    }
    await queryRunner.query(`DROP INDEX "IDX_tcs_teacher_section"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_tcs_teacher_section_subject" ON "teacher_class_sections" ("teacher_id", "section_id", "subject_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tcs_teacher_section_no_subject" ON "teacher_class_sections" ("teacher_id", "section_id") WHERE "subject_id" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_tcs_teacher_section_no_subject"`);
    await queryRunner.query(`DROP INDEX "IDX_tcs_teacher_section_subject"`);

    // The old (teacher_id, section_id) uniqueness cannot come back if a
    // teacher now has two rows for the same section under different
    // subjects — recreating the index would otherwise fail with an opaque
    // Postgres constraint-violation error. Fail loudly with the actual
    // rows at fault instead, so an operator can decide how to resolve them
    // (merge, delete, or keep the subject-aware schema) before retrying.
    const duplicates = await queryRunner.query(`
      SELECT "teacher_id", "section_id", count(*)::int AS count
      FROM "teacher_class_sections"
      GROUP BY "teacher_id", "section_id"
      HAVING count(*) > 1
    `);
    if (duplicates.length > 0) {
      throw new Error(
        `AddSubjectsAndClassSubjects: cannot revert — ${duplicates.length} ` +
          `(teacher_id, section_id) pair(s) have more than one row (distinct ` +
          `subject_id values), which the old (teacher_id, section_id) unique ` +
          `index cannot represent. Resolve these rows (merge or delete the ` +
          `extras) before reverting this migration.`,
      );
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_tcs_teacher_section" ON "teacher_class_sections" ("teacher_id", "section_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "teacher_class_sections" DROP CONSTRAINT "FK_teacher_class_sections_subject"`,
    );
    await queryRunner.query(`ALTER TABLE "teacher_class_sections" DROP COLUMN "subject_id"`);

    await queryRunner.query(`DROP INDEX "IDX_teacher_class_sections_tenant_id"`);
    await queryRunner.query(
      `ALTER TABLE "teacher_class_sections" DROP CONSTRAINT "FK_teacher_class_sections_tenant"`,
    );
    await queryRunner.query(`ALTER TABLE "teacher_class_sections" DROP COLUMN "tenant_id"`);

    await queryRunner.query(`DROP TABLE "class_subjects"`);
    await queryRunner.query(`DROP TABLE "subjects"`);
  }
}
