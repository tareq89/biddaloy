import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [#666] `invoice_share_tokens` — public share links onto one invoice's
 * receipt view. Only a SHA-256 hash of the raw token is ever stored
 * (`token_hash`); the raw token itself never touches the database, so a
 * DB dump leak cannot be replayed as a working link.
 *
 * `tenant_id` is a direct column (not just derivable via `invoice_id`)
 * because the public route that consumes a token never sees an
 * `X-Tenant-ID` header — the token row is the only source of tenant
 * scope on that path.
 */
export class AddInvoiceShareTokens1789800009000 implements MigrationInterface {
  name = 'AddInvoiceShareTokens1789800009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "invoice_share_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "invoice_id" uuid NOT NULL,
        "token_hash" char(64) NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "revoked_at" timestamptz,
        "last_viewed_at" timestamptz,
        "view_count" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_invoice_share_tokens" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_invoice_share_tokens_token_hash" ON "invoice_share_tokens" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_invoice_share_tokens_invoice_id" ON "invoice_share_tokens" ("invoice_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_invoice_share_tokens_tenant_id" ON "invoice_share_tokens" ("tenant_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_share_tokens" ADD CONSTRAINT "FK_invoice_share_tokens_invoice_id" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_share_tokens" ADD CONSTRAINT "FK_invoice_share_tokens_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_share_tokens" ADD CONSTRAINT "FK_invoice_share_tokens_created_by_user_id" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_share_tokens"`);
  }
}
