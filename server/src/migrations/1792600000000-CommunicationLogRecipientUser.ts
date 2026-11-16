import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [80.1.03] `communication_logs.recipient_user_id` (staff recipient, nullable, SET NULL) plus the
 * `STAFF_MESSAGE` and `MARKS_SMS` trigger values (added in shared by #4333).
 */
export class CommunicationLogRecipientUser1792600000000 implements MigrationInterface {
  name = 'CommunicationLogRecipientUser1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The new values are not used in this migration, so they can share its transaction.
    await queryRunner.query(
      `ALTER TYPE "public"."communication_logs_trigger_enum" ADD VALUE IF NOT EXISTS 'STAFF_MESSAGE'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."communication_logs_trigger_enum" ADD VALUE IF NOT EXISTS 'MARKS_SMS'`,
    );
    await queryRunner.query(`ALTER TABLE "communication_logs" ADD "recipient_user_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_d19b5daa4e94a746ac1ea89c98" ON "communication_logs" ("tenant_id", "recipient_user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "communication_logs" ADD CONSTRAINT "FK_a9da9d047e3baca851aea0013be" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  // Postgres cannot DROP an enum value (and recreating the type fails on a populated table), so
  // STAFF_MESSAGE / MARKS_SMS stay, as ARRIVAL_NOTICE does in 1791900000700.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "communication_logs" DROP CONSTRAINT "FK_a9da9d047e3baca851aea0013be"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_d19b5daa4e94a746ac1ea89c98"`);
    await queryRunner.query(`ALTER TABLE "communication_logs" DROP COLUMN "recipient_user_id"`);
  }
}
