import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [5.4c] Per-guardian opt-out from automated fee reminders.
 *
 * `NOT NULL DEFAULT true` is load-bearing in both directions: it backfills
 * every existing guardian as reachable (a default of `false` would switch
 * off fee reminders school-wide), and it keeps INSERTs from not-yet-
 * redeployed old code — which does not know the column — valid during a
 * rolling deploy. Keep the default; do not "clean it up" later.
 */
export class AddGuardianNotificationsEnabled1787702400000 implements MigrationInterface {
  name = 'AddGuardianNotificationsEnabled1787702400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "guardians" ADD "notifications_enabled" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "guardians" DROP COLUMN "notifications_enabled"`);
  }
}
