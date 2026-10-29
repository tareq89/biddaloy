import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [84.1.2] `arrival_notice_subscriptions` + `ARRIVAL_NOTICE` value on
 * `communication_logs.trigger`.
 */
export class ArrivalNoticeSubscriptions1791900000700 implements MigrationInterface {
  name = 'ArrivalNoticeSubscriptions1791900000700';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."communication_logs_trigger_enum" ADD VALUE IF NOT EXISTS 'ARRIVAL_NOTICE'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."arrival_notice_subscriptions_status_enum" AS ENUM('REQUESTED', 'ACTIVE', 'OFF')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."arrival_notice_subscriptions_mode_enum" AS ENUM('ONCE', 'RECURRING')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."arrival_notice_subscriptions_channel_enum" AS ENUM('PUSH', 'SMS')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."arrival_notice_subscriptions_lock_enum" AS ENUM('NONE', 'ALWAYS', 'NEVER')`,
    );
    await queryRunner.query(
      `CREATE TABLE "arrival_notice_subscriptions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "guardian_id" uuid NOT NULL,
        "status" "public"."arrival_notice_subscriptions_status_enum" NOT NULL DEFAULT 'REQUESTED',
        "mode" "public"."arrival_notice_subscriptions_mode_enum" NOT NULL DEFAULT 'RECURRING',
        "channel" "public"."arrival_notice_subscriptions_channel_enum" NOT NULL DEFAULT 'PUSH',
        "lock" "public"."arrival_notice_subscriptions_lock_enum" NOT NULL DEFAULT 'NONE',
        "set_by_user_id" uuid,
        "locked_by_user_id" uuid,
        "consumed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_arrival_notice_subscriptions" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_arrival_notice_subscriptions_tenant_student_guardian" ON "arrival_notice_subscriptions" ("tenant_id", "student_id", "guardian_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_arrival_notice_subscriptions_tenant_status" ON "arrival_notice_subscriptions" ("tenant_id", "status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "arrival_notice_subscriptions" ADD CONSTRAINT "FK_f35511e14bdf0d7fd83634e885e" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "arrival_notice_subscriptions" ADD CONSTRAINT "FK_38fc2840c87d900fb553b29b16f" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "arrival_notice_subscriptions" ADD CONSTRAINT "FK_d0cd107608fb35dd4c62d2f37d4" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "arrival_notice_subscriptions" ADD CONSTRAINT "FK_e0377bfafa651dc17d2282b0adc" FOREIGN KEY ("set_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "arrival_notice_subscriptions" ADD CONSTRAINT "FK_4ff4d872cf265ad2abe8ea32737" FOREIGN KEY ("locked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "arrival_notice_subscriptions"`);
    await queryRunner.query(`DROP TYPE "public"."arrival_notice_subscriptions_lock_enum"`);
    await queryRunner.query(`DROP TYPE "public"."arrival_notice_subscriptions_channel_enum"`);
    await queryRunner.query(`DROP TYPE "public"."arrival_notice_subscriptions_mode_enum"`);
    await queryRunner.query(`DROP TYPE "public"."arrival_notice_subscriptions_status_enum"`);
    // Postgres cannot DROP a single enum value. 'ARRIVAL_NOTICE' stays on
    // communication_logs_trigger_enum; it is harmless once the table is gone
    // and removing it would fail on any log row that already uses it.
  }
}
