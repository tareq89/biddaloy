import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The plain unique constraint on (student_id, fee_structure_id,
 * period_start, occurrence) does not know about `deleted_at`
 * (AddStudentFeesDeletedAt1789800006000) — a hard DB constraint still
 * blocks a second row at the same key even after the first one was
 * soft-deleted. That breaks `findDuplicates()` in
 * fee-generation.service.ts, which uses TypeORM's `find()` and is
 * therefore soft-delete-aware (it excludes rows with `deleted_at` set):
 * remove a bill → regenerate the same period → `findDuplicates` reports
 * no duplicate → the insert then hits the still-active unique
 * constraint → `.orIgnore()` swallows the conflict → the bill is never
 * recreated and `generated_count` under-reports.
 *
 * Fix: replace the constraint with a partial unique index that only
 * applies to live rows (`WHERE deleted_at IS NULL`), matching what the
 * soft-delete-aware `find()` already assumes.
 */
export class StudentFeesPartialUniqueIndex1789800007000 implements MigrationInterface {
  name = 'StudentFeesPartialUniqueIndex1789800007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "student_fees" DROP CONSTRAINT "UQ_student_fees_student_structure_period_occurrence"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_student_fees_active_student_structure_period_occurrence" ON "student_fees" ("student_id", "fee_structure_id", "period_start", "occurrence") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_student_fees_active_student_structure_period_occurrence"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_fees" ADD CONSTRAINT "UQ_student_fees_student_structure_period_occurrence" UNIQUE ("student_id", "fee_structure_id", "period_start", "occurrence")`,
    );
  }
}
