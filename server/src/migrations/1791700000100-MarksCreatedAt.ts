import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [68.1.fix F2] `marks.created_at`: when a cell was first written. The exam
 * cohort falls back to the first mark write as the sitting date, and
 * `updated_at` moves on every grid re-save. Existing rows take their
 * `updated_at`, the best date known for them.
 */
export class MarksCreatedAt1791700000100 implements MigrationInterface {
  name = 'MarksCreatedAt1791700000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "marks" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`UPDATE "marks" SET "created_at" = "updated_at"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "marks" DROP COLUMN "created_at"`);
  }
}
