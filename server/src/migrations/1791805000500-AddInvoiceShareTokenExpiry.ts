import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [75.19-b, D9/D22] Public invoice share links expire. Every link that exists
 * when this runs gets 30 days from the migration (not from `created_at`), so
 * no link dies on deploy day. The column is NOT NULL with a 30-day default.
 */
export class AddInvoiceShareTokenExpiry1791805000500 implements MigrationInterface {
  name = 'AddInvoiceShareTokenExpiry1791805000500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // One metadata-only statement: existing rows get deploy + 30 days (D22) and
    // old-code inserts during a rolling deploy pick up the default.
    await queryRunner.query(
      `ALTER TABLE "invoice_share_tokens" ADD COLUMN "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '30 days')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Turn expiry into revocation so expired links stay dead after a rollback.
    await queryRunner.query(
      `UPDATE "invoice_share_tokens" SET "revoked_at" = "expires_at" WHERE "revoked_at" IS NULL AND "expires_at" <= now()`,
    );
    await queryRunner.query(`ALTER TABLE "invoice_share_tokens" DROP COLUMN "expires_at"`);
  }
}
