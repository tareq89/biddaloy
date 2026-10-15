import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [8.10.7.2.13] (8.10.7 D40) `exams.mark_entry_deadline` (nullable date, last day
 * for mark entry) and the `communication_logs (tenant_id, status, created_at)`
 * index that serves the failed-message / pending-reminder dashboard counts.
 */
export class ExamMarkEntryDeadlineAndCommsIndex1791900000100 implements MigrationInterface {
  name = 'ExamMarkEntryDeadlineAndCommsIndex1791900000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "exams" ADD COLUMN "mark_entry_deadline" date NULL`);
    await queryRunner.query(
      `CREATE INDEX "IDX_91e00e5f77a240b92c6713ef1d" ON "communication_logs" ("tenant_id", "status", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_91e00e5f77a240b92c6713ef1d"`);
    await queryRunner.query(`ALTER TABLE "exams" DROP COLUMN "mark_entry_deadline"`);
  }
}
