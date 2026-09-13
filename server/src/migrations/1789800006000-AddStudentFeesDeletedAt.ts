import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [16.3.2] Batch mutations (#651) needs to soft-delete individual bills —
 * "remove uncollected", "remove a student from a batch", "delete a whole
 * batch" all delete `student_fees` rows without touching payment history.
 * `student_fees` never had a `deleted_at` column (missed at preflight,
 * caught when #651 tried to implement against the real schema) — this
 * adds it, following the same nullable-timestamp + partial-index pattern
 * TypeORM's `@DeleteDateColumn` uses elsewhere (see `FeeGeneration`'s own
 * `deleted_at`, [16.1.4]).
 */
export class AddStudentFeesDeletedAt1789800006000 implements MigrationInterface {
  name = 'AddStudentFeesDeletedAt1789800006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "student_fees" ADD "deleted_at" TIMESTAMPTZ`);
    await queryRunner.query(
      `CREATE INDEX "IDX_student_fees_deleted_at" ON "student_fees" ("deleted_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_student_fees_deleted_at"`);
    await queryRunner.query(`ALTER TABLE "student_fees" DROP COLUMN "deleted_at"`);
  }
}
