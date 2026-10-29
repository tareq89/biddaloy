import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [Epic 88 D3] Marks schools a visitor registered on the public demo deployment, so the demo boot
 * check can tell them apart from a real school. One metadata-only statement; existing rows get false.
 */
export class SchoolsCreatedInDemo1791900001000 implements MigrationInterface {
  name = 'SchoolsCreatedInDemo1791900001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "schools" ADD COLUMN "created_in_demo" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "created_in_demo"`);
  }
}
