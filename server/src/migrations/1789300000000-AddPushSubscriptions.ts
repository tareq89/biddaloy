import { MigrationInterface, QueryRunner } from 'typeorm';

/** [#552] Storage for user-owned, multi-device web push subscriptions.
 * A user can have many rows (one per browser/device); `endpoint` is
 * globally unique since the browser-issued push endpoint URL already
 * identifies one subscription. `tenant_id` is stored directly (not
 * derived via `user_id`) so a row is unambiguously scoped even if the
 * user's tenant membership changes later — same rationale as
 * `sms_credit_ledger`. Rollback drops the table; safe as long as no
 * push-sending code has written rows yet, since `down` here is a hard
 * `DROP TABLE`.
 */
export class AddPushSubscriptions1789300000000 implements MigrationInterface {
  name = 'AddPushSubscriptions1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "push_subscriptions" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"user_id" uuid NOT NULL, ` +
        `"tenant_id" uuid NOT NULL, ` +
        `"endpoint" text NOT NULL, ` +
        `"p256dh" text NOT NULL, ` +
        `"auth" text NOT NULL, ` +
        `"user_agent" text, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"last_used_at" TIMESTAMP WITH TIME ZONE, ` +
        `"failure_count" integer NOT NULL DEFAULT 0, ` +
        `CONSTRAINT "UQ_push_subscriptions_endpoint" UNIQUE ("endpoint"), ` +
        `CONSTRAINT "PK_push_subscriptions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_push_subscriptions_user" ON "push_subscriptions" ("user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" ADD CONSTRAINT "FK_push_subscriptions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" ADD CONSTRAINT "FK_push_subscriptions_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" DROP CONSTRAINT "FK_push_subscriptions_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_subscriptions" DROP CONSTRAINT "FK_push_subscriptions_user"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_push_subscriptions_user"`);
    await queryRunner.query(`DROP TABLE "push_subscriptions"`);
  }
}
