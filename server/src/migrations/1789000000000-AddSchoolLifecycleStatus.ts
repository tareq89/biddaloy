import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [15.4] `status` / `status_reason` / `status_changed_at` on `schools`.
 *
 * `status` is a plain `varchar` guarded by a check constraint (not a
 * Postgres `enum` type) so it's cheap to extend later. Every existing row
 * gets the column default `'ACTIVE'`, so no backfill query is needed.
 *
 * Rollback (`down`) is safe: it only drops these three columns. No other
 * data is touched, and the only thing lost on rollback is the status
 * itself (schools revert to having no lifecycle state, same as before
 * this migration ran).
 */
export class AddSchoolLifecycleStatus1789000000000 implements MigrationInterface {
  name = 'AddSchoolLifecycleStatus1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "status" character varying(20) NOT NULL DEFAULT 'ACTIVE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "schools" ADD CONSTRAINT "CHK_schools_status" CHECK ("status" IN ('ACTIVE', 'SUSPENDED'))`,
    );
    await queryRunner.query(`ALTER TABLE "schools" ADD "status_reason" text`);
    await queryRunner.query(
      `ALTER TABLE "schools" ADD "status_changed_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "status_changed_at"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "status_reason"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP CONSTRAINT "CHK_schools_status"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "status"`);
  }
}
