import { MigrationInterface, QueryRunner } from 'typeorm';

/** [15.6.2/#545] Immutable SMS credit ledger + per-tenant running balance.
 * No rows are created for existing tenants — `sms_credit_balance` gets a
 * row lazily on first credit movement (#546), and with no `sms.metering`
 * setting stored, every existing tenant reads as OFF (unmetered,
 * unchanged behaviour) via the tenant-settings resolver default. Rollback
 * drops both tables and their enums; safe as long as no #546/#547 code
 * has written ledger rows yet, since `down` here is a hard `DROP TABLE`.
 */
export class AddSmsCreditLedger1789200000000 implements MigrationInterface {
  name = 'AddSmsCreditLedger1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."sms_credit_ledger_kind_enum" AS ENUM('GRANT', 'RESERVE', 'DEBIT', 'RELEASE', 'ADJUST')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."sms_credit_ledger_reference_type_enum" AS ENUM('batch', 'log', 'manual')`,
    );
    await queryRunner.query(
      `CREATE TABLE "sms_credit_ledger" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"tenant_id" uuid NOT NULL, ` +
        `"kind" "public"."sms_credit_ledger_kind_enum" NOT NULL, ` +
        `"units" integer NOT NULL, ` +
        `"reference_type" "public"."sms_credit_ledger_reference_type_enum" NOT NULL, ` +
        `"reference_id" uuid, ` +
        `"idempotency_key" text NOT NULL, ` +
        `"reason" text, ` +
        `"actor_user_id" uuid, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_sms_credit_ledger_tenant_idempotency" UNIQUE ("tenant_id", "idempotency_key"), ` +
        `CONSTRAINT "PK_sms_credit_ledger" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sms_credit_ledger_tenant_created" ON "sms_credit_ledger" ("tenant_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "sms_credit_ledger" ADD CONSTRAINT "FK_sms_credit_ledger_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sms_credit_ledger" ADD CONSTRAINT "FK_sms_credit_ledger_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "sms_credit_balance" (` +
        `"tenant_id" uuid NOT NULL, ` +
        `"available" integer NOT NULL DEFAULT 0, ` +
        `"reserved" integer NOT NULL DEFAULT 0, ` +
        `"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "CHK_sms_credit_balance_nonnegative" CHECK ("available" >= 0 AND "reserved" >= 0), ` +
        `CONSTRAINT "PK_sms_credit_balance" PRIMARY KEY ("tenant_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "sms_credit_balance" ADD CONSTRAINT "FK_sms_credit_balance_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sms_credit_balance" DROP CONSTRAINT "FK_sms_credit_balance_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "sms_credit_balance"`);

    await queryRunner.query(
      `ALTER TABLE "sms_credit_ledger" DROP CONSTRAINT "FK_sms_credit_ledger_actor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sms_credit_ledger" DROP CONSTRAINT "FK_sms_credit_ledger_tenant"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_sms_credit_ledger_tenant_created"`);
    await queryRunner.query(`DROP TABLE "sms_credit_ledger"`);

    await queryRunner.query(`DROP TYPE "public"."sms_credit_ledger_reference_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."sms_credit_ledger_kind_enum"`);
  }
}
