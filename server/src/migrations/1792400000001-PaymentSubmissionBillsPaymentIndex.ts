import { MigrationInterface, QueryRunner } from 'typeorm';

/** [3.x] The reversal sync looks up the submissions of a payment by (tenant_id, payment_id). */
export class PaymentSubmissionBillsPaymentIndex1792400000001 implements MigrationInterface {
  name = 'PaymentSubmissionBillsPaymentIndex1792400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payment_submission_bills_tenant_payment" ON "payment_submission_bills" ("tenant_id", "payment_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_payment_submission_bills_tenant_payment"`,
    );
  }
}
