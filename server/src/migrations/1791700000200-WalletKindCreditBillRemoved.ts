import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MON-03 (#2241): when a bill that already holds checkout money is removed,
 * that money is credited to the student's wallet as `CREDIT_BILL_REMOVED`.
 * The shared enum has the value; this adds it to the database type.
 * No table or column changes.
 */
export class WalletKindCreditBillRemoved1791700000200 implements MigrationInterface {
  name = 'WalletKindCreditBillRemoved1791700000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."wallet_transactions_kind_enum" ADD VALUE IF NOT EXISTS 'CREDIT_BILL_REMOVED'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot drop a single enum value; left as a documented no-op,
    // same convention as AddLateFeeTypeEnumValue1789800009500.
  }
}
