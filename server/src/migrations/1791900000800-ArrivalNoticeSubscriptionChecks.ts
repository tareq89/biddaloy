import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [84 follow-up] `arrival_notice_subscriptions`: `declined_at`, a guardian_id index and
 * CHECKs for the D35 rules. Rows are normalized first so the CHECKs can be added.
 */
export class ArrivalNoticeSubscriptionChecks1791900000800 implements MigrationInterface {
  name = 'ArrivalNoticeSubscriptionChecks1791900000800';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "arrival_notice_subscriptions" ADD "declined_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "arrival_notice_subscriptions" ADD "set_at" TIMESTAMP WITH TIME ZONE, ADD "locked_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Best known dates for rows that already name a setter / locker.
    await queryRunner.query(
      `UPDATE "arrival_notice_subscriptions"
          SET "set_at" = CASE WHEN "set_by_user_id" IS NOT NULL THEN "updated_at" END,
              "locked_at" = CASE WHEN "locked_by_user_id" IS NOT NULL THEN "updated_at" END`,
    );
    // Normalize: ALWAYS = ACTIVE + RECURRING + unconsumed; NEVER = OFF; consumed_at only for ONCE.
    await queryRunner.query(
      `UPDATE "arrival_notice_subscriptions"
          SET "status" = 'ACTIVE', "mode" = 'RECURRING', "consumed_at" = NULL
        WHERE "lock" = 'ALWAYS'
          AND ("status" <> 'ACTIVE' OR "mode" <> 'RECURRING' OR "consumed_at" IS NOT NULL)`,
    );
    await queryRunner.query(
      `UPDATE "arrival_notice_subscriptions" SET "status" = 'OFF', "consumed_at" = NULL
        WHERE "lock" = 'NEVER' AND "status" <> 'OFF'`,
    );
    await queryRunner.query(
      `UPDATE "arrival_notice_subscriptions" SET "consumed_at" = NULL
        WHERE "consumed_at" IS NOT NULL AND "mode" <> 'ONCE'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_arrival_notice_subscriptions_guardian" ON "arrival_notice_subscriptions" ("guardian_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "arrival_notice_subscriptions" ADD CONSTRAINT "CHK_arrival_notice_subscriptions_never_off" CHECK ("lock" <> 'NEVER' OR "status" = 'OFF')`,
    );
    await queryRunner.query(
      `ALTER TABLE "arrival_notice_subscriptions" ADD CONSTRAINT "CHK_arrival_notice_subscriptions_always_active_recurring" CHECK ("lock" <> 'ALWAYS' OR ("status" = 'ACTIVE' AND "mode" = 'RECURRING' AND "consumed_at" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "arrival_notice_subscriptions" ADD CONSTRAINT "CHK_arrival_notice_subscriptions_consumed_once" CHECK ("consumed_at" IS NULL OR "mode" = 'ONCE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "arrival_notice_subscriptions" ADD CONSTRAINT "CHK_arrival_notice_subscriptions_declined_off" CHECK ("declined_at" IS NULL OR "status" = 'OFF')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const c of ['declined_off', 'consumed_once', 'always_active_recurring', 'never_off']) {
      await queryRunner.query(
        `ALTER TABLE "arrival_notice_subscriptions" DROP CONSTRAINT "CHK_arrival_notice_subscriptions_${c}"`,
      );
    }
    await queryRunner.query(`DROP INDEX "public"."IDX_arrival_notice_subscriptions_guardian"`);
    await queryRunner.query(`ALTER TABLE "arrival_notice_subscriptions" DROP COLUMN "declined_at"`);
    await queryRunner.query(
      `ALTER TABLE "arrival_notice_subscriptions" DROP COLUMN "set_at", DROP COLUMN "locked_at"`,
    );
  }
}
