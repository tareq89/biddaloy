import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the student-wallet credit balance (16.1.5): `student_wallets` (one
 * row per student per tenant, current balance) and `wallet_transactions`
 * (an append-only ledger of every balance move).
 *
 * `wallet_transactions` gets the same write-only trigger pattern as
 * `audit_logs` (`trg_audit_logs_write_only` /
 * `1784175065078-InitialSchema.ts:262`): a dedicated trigger function
 * rejects UPDATE/DELETE outright, so a correction is always a new
 * `REVERSAL` row (16.6.1), never an edit of history.
 *
 * Every FK onto `wallet_transactions` (and its own parent FKs) uses
 * `ON DELETE RESTRICT`, not `CASCADE` — same reasoning as
 * `1785749259955-AddTenantIdToAuditLogs.ts`: a cascaded DELETE is still a
 * row-level DELETE and fires the write-only trigger, aborting the parent
 * delete with a confusing "write-only" error instead of an ordinary FK
 * violation. RESTRICT fails the parent delete cleanly instead.
 */
export class AddStudentWallets1789800003000 implements MigrationInterface {
  name = 'AddStudentWallets1789800003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "student_wallets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "balance" numeric(12,2) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_student_wallets" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_wallets" ADD CONSTRAINT "CHK_sw_balance_non_negative" CHECK ("balance" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_wallets" ADD CONSTRAINT "UQ_student_wallets_tenant_student" UNIQUE ("tenant_id", "student_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_wallets_tenant_id" ON "student_wallets" ("tenant_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_wallets" ADD CONSTRAINT "FK_sw_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_wallets" ADD CONSTRAINT "FK_sw_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."wallet_transactions_kind_enum" AS ENUM('CREDIT_OVERPAYMENT', 'CREDIT_CHANGE', 'DEBIT_CHECKOUT', 'DEBIT_GENERATION', 'REVERSAL')`,
    );
    await queryRunner.query(
      `CREATE TABLE "wallet_transactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "wallet_id" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "kind" "public"."wallet_transactions_kind_enum" NOT NULL,
        "payment_id" uuid,
        "student_fee_id" uuid,
        "reversal_of_id" uuid,
        "created_by_user_id" uuid,
        "note" character varying(200),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallet_transactions" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_transactions_tenant_id" ON "wallet_transactions" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_transactions_wallet_id_created_at" ON "wallet_transactions" ("wallet_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD CONSTRAINT "FK_wt_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" ADD CONSTRAINT "FK_wt_wallet" FOREIGN KEY ("wallet_id") REFERENCES "student_wallets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE OR REPLACE FUNCTION "public"."block_wallet_transactions_write_only"() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'wallet_transactions is write-only: updates and deletes are not permitted'; END; $$ LANGUAGE plpgsql`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "trg_wallet_transactions_write_only" BEFORE UPDATE OR DELETE ON "wallet_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."block_wallet_transactions_write_only"()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_wallet_transactions_write_only" ON "wallet_transactions"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "public"."block_wallet_transactions_write_only"()`,
    );
    await queryRunner.query(`DROP TABLE "wallet_transactions"`);
    await queryRunner.query(`DROP TYPE "public"."wallet_transactions_kind_enum"`);
    await queryRunner.query(`DROP TABLE "student_wallets"`);
  }
}
