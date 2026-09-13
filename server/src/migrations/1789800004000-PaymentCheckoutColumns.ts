import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [16.1.6] Payments: idempotency + checkout/reversal columns, allocation
 * discount, and D16's final `payment_method` value set.
 *
 * - `payments.idempotency_key` + a partial unique index on
 *   `(tenant_id, idempotency_key)` (only when the key is non-null, since
 *   most payments — anything recorded before the checkout endpoint lands
 *   in 16.4.2 — never set one) let `PaymentAllocationService` short-circuit
 *   a retried request instead of double-charging.
 * - `tendered_amount`/`change_amount`/`wallet_credit_used`/
 *   `wallet_credit_added`/`reversal_of_payment_id`/`reversed_by_payment_id`/
 *   `reversal_reason`/`approved_by_user_id` are additive columns the
 *   checkout (16.4.2) and reversal flows will populate; this ticket only
 *   prepares the model.
 * - `payment_allocations.discount_amount` records a one-off discount
 *   granted on that specific line at checkout time.
 * - `payments_payment_method_enum` is swapped to D16's final set
 *   (`CASH, CHEQUE, BANK_TRANSFER, CARD, BKASH, NAGAD, ROCKET`), dropping
 *   `ONLINE`/`UPI`. Per D19 ("no production data: migrations may drop and
 *   recreate") this is a straight swap with no legacy-value mapping.
 */
export class PaymentCheckoutColumns1789800004000 implements MigrationInterface {
  name = 'PaymentCheckoutColumns1789800004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- payments: new columns ---
    await queryRunner.query(`ALTER TABLE "payments" ADD "idempotency_key" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "payments" ADD "tendered_amount" numeric(12,2)`);
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "change_amount" numeric(12,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "wallet_credit_used" numeric(12,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD "wallet_credit_added" numeric(12,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE "payments" ADD "reversal_of_payment_id" uuid`);
    await queryRunner.query(`ALTER TABLE "payments" ADD "reversed_by_payment_id" uuid`);
    await queryRunner.query(`ALTER TABLE "payments" ADD "reversal_reason" character varying(500)`);
    await queryRunner.query(`ALTER TABLE "payments" ADD "approved_by_user_id" uuid`);

    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_payments_reversal_of_payment" FOREIGN KEY ("reversal_of_payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_payments_reversed_by_payment" FOREIGN KEY ("reversed_by_payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_payments_approved_by_user" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // Partial unique index: many payments will never carry a key (anything
    // recorded through the plain record-with-allocation path today), so a
    // full unique constraint would reject the second and every later NULL.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_payments_tenant_idempotency_key" ON "payments" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_tenant_payment_date" ON "payments" ("tenant_id", "payment_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_received_by_user" ON "payments" ("received_by_user_id")`,
    );

    // --- payment_allocations: new column ---
    await queryRunner.query(
      `ALTER TABLE "payment_allocations" ADD "discount_amount" numeric(10,2) NOT NULL DEFAULT 0`,
    );

    // --- payment_method enum: swap to D16's final set ---
    // D19: no production data, so this is a straight drop-and-recreate —
    // no ONLINE/UPI -> new-value mapping is kept.
    await queryRunner.query(
      `ALTER TYPE "public"."payments_payment_method_enum" RENAME TO "payments_payment_method_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payments_payment_method_enum" AS ENUM('CASH', 'CHEQUE', 'BANK_TRANSFER', 'CARD', 'BKASH', 'NAGAD', 'ROCKET')`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "payment_method" TYPE "public"."payments_payment_method_enum" USING "payment_method"::text::"public"."payments_payment_method_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."payments_payment_method_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse the enum swap first, same drop-and-recreate shape as `up()`.
    // Fails loudly if a BKASH/NAGAD/ROCKET row already exists — expected,
    // same as every other enum-shrinking `down()` in this repo.
    await queryRunner.query(
      `ALTER TYPE "public"."payments_payment_method_enum" RENAME TO "payments_payment_method_enum_new"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payments_payment_method_enum" AS ENUM('CASH', 'CHEQUE', 'BANK_TRANSFER', 'ONLINE', 'CARD', 'UPI')`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "payment_method" TYPE "public"."payments_payment_method_enum" USING "payment_method"::text::"public"."payments_payment_method_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."payments_payment_method_enum_new"`);

    await queryRunner.query(`ALTER TABLE "payment_allocations" DROP COLUMN "discount_amount"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_payments_received_by_user"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_tenant_payment_date"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_payments_tenant_idempotency_key"`);

    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_payments_approved_by_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_payments_reversed_by_payment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_payments_reversal_of_payment"`,
    );

    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "approved_by_user_id"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "reversal_reason"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "reversed_by_payment_id"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "reversal_of_payment_id"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "wallet_credit_added"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "wallet_credit_used"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "change_amount"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "tendered_amount"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "idempotency_key"`);
  }
}
