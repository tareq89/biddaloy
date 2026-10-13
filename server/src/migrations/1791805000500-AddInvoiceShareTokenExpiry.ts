import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [75.19-b, D9/D22] Public invoice share links expire. Every link that exists
 * when this runs gets 30 days from the migration (not from `created_at`), so
 * no link dies on deploy day. The column is NOT NULL afterwards.
 */
export class AddInvoiceShareTokenExpiry1791805000500 implements MigrationInterface {
  name = 'AddInvoiceShareTokenExpiry1791805000500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_share_tokens" ADD COLUMN "expires_at" timestamptz`,
    );
    await queryRunner.query(
      `UPDATE "invoice_share_tokens" SET "expires_at" = now() + interval '30 days'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_share_tokens" ALTER COLUMN "expires_at" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invoice_share_tokens" DROP COLUMN "expires_at"`);
  }
}
