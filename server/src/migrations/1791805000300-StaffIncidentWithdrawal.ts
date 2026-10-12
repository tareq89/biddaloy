import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [68.4 GAP-11] An incident filed against the wrong person (or falsely) can be
 * withdrawn with a reason. The row stays; lists and the performance view skip it.
 */
export class StaffIncidentWithdrawal1791805000300 implements MigrationInterface {
  name = 'StaffIncidentWithdrawal1791805000300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff_incidents"
         ADD COLUMN "withdrawn_at" timestamptz NULL,
         ADD COLUMN "withdrawn_by_user_id" uuid NULL,
         ADD COLUMN "withdraw_reason" text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_incidents" ADD CONSTRAINT "FK_staff_incidents_withdrawn_by" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_incidents" ADD CONSTRAINT "CHK_staff_incidents_withdraw_reason" CHECK ("withdrawn_at" IS NULL OR ("withdraw_reason" IS NOT NULL AND length(btrim("withdraw_reason")) > 0))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff_incidents" DROP CONSTRAINT "CHK_staff_incidents_withdraw_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_incidents" DROP CONSTRAINT "FK_staff_incidents_withdrawn_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_incidents" DROP COLUMN "withdraw_reason", DROP COLUMN "withdrawn_by_user_id", DROP COLUMN "withdrawn_at"`,
    );
  }
}
