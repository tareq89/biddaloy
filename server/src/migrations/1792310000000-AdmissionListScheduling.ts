import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [Epic 71 / #4182] Scheduling columns on `admission_lists`: how many seats the list offers,
 * the date its offers lapse, when it was activated, and the filter a FILTER list was built with.
 * Existing lists (none in production yet) get capacity 0.
 */
export class AdmissionListScheduling1792310000000 implements MigrationInterface {
  name = 'AdmissionListScheduling1792310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admission_lists"
        ADD "capacity" integer NOT NULL DEFAULT 0,
        ADD "act_by_date" date,
        ADD "activated_at" TIMESTAMP WITH TIME ZONE,
        ADD "filter" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_lists" ADD CONSTRAINT "CHK_admission_lists_capacity" CHECK ("capacity" >= 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admission_lists" DROP CONSTRAINT "CHK_admission_lists_capacity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admission_lists"
        DROP COLUMN "filter", DROP COLUMN "activated_at", DROP COLUMN "act_by_date", DROP COLUMN "capacity"`,
    );
  }
}
