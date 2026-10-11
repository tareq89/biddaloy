import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MON-09 (#2242): paying wallet money out as a cash refund writes a
 * `DEBIT_PAYOUT` ledger row. The shared enum has the value; this adds it to
 * the database type. No table or column changes.
 */
export class WalletKindDebitPayout1791700000300 implements MigrationInterface {
  name = 'WalletKindDebitPayout1791700000300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."wallet_transactions_kind_enum" ADD VALUE IF NOT EXISTS 'DEBIT_PAYOUT'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot drop a single enum value; left as a documented no-op,
    // same convention as WalletKindCreditBillRemoved1791700000200.
  }
}
