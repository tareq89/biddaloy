import { MigrationInterface, QueryRunner } from 'typeorm';

// TEN-04: invoice numbers become a per-school series; unique per (tenant_id, invoice_number).
const fn = (withTenant: boolean) => `
  CREATE OR REPLACE FUNCTION "public"."enforce_invoice_immutability"() RETURNS TRIGGER AS $$
  BEGIN
    IF OLD."status" <> 'DRAFT' AND NEW."status" = 'DRAFT' THEN
      RAISE EXCEPTION 'invoice cannot return to DRAFT once issued (id=%)', OLD."id";
    ELSIF OLD."status" <> 'DRAFT' AND (
      NEW."invoice_number" IS DISTINCT FROM OLD."invoice_number" OR
      NEW."kind" IS DISTINCT FROM OLD."kind" OR
      NEW."student_id" IS DISTINCT FROM OLD."student_id" OR
      NEW."payment_id" IS DISTINCT FROM OLD."payment_id" OR
      NEW."related_invoice_id" IS DISTINCT FROM OLD."related_invoice_id" OR
      NEW."total_amount" IS DISTINCT FROM OLD."total_amount" OR
      NEW."tax_amount" IS DISTINCT FROM OLD."tax_amount" OR
      NEW."discount_amount" IS DISTINCT FROM OLD."discount_amount" OR
      NEW."issued_date" IS DISTINCT FROM OLD."issued_date" OR
      NEW."due_date" IS DISTINCT FROM OLD."due_date" OR
      NEW."snapshot" IS DISTINCT FROM OLD."snapshot" OR
      NEW."issued_by_user_id" IS DISTINCT FROM OLD."issued_by_user_id" OR
      NEW."notes" IS DISTINCT FROM OLD."notes" OR
      NEW."issuer_snapshot" IS DISTINCT FROM OLD."issuer_snapshot" OR${
        withTenant ? '\n      NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" OR' : ''
      }
      NEW."created_at" IS DISTINCT FROM OLD."created_at"
    ) THEN
      RAISE EXCEPTION 'invoices is immutable once issued: only status, updated_at, deleted_at may change (id=%)', OLD."id";
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`;

export class InvoicesTenantScopedNumber1791600000300 implements MigrationInterface {
  name = 'InvoicesTenantScopedNumber1791600000300';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "invoices" ADD "tenant_id" uuid`);
    await q.query(
      `UPDATE "invoices" i SET "tenant_id" = s."tenant_id" FROM "students" s WHERE s."id" = i."student_id"`,
    );
    await q.query(`ALTER TABLE "invoices" ALTER COLUMN "tenant_id" SET NOT NULL`);
    await q.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_invoices_tenant" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(`CREATE INDEX "IDX_invoices_tenant_id" ON "invoices" ("tenant_id")`);
    await q.query(`ALTER TABLE "invoices" DROP CONSTRAINT "UQ_d8f8d3788694e1b3f96c42c36fb"`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_invoices_tenant_invoice_number" ON "invoices" ("tenant_id", "invoice_number")`,
    );
    await q.query(fn(true));
  }

  // Only works before two schools hold the same number (e.g. both have INV-2026-00001): after
  // that, re-adding the global UNIQUE ("invoice_number") fails with 23505. Not a production rollback.
  public async down(q: QueryRunner): Promise<void> {
    await q.query(fn(false));
    await q.query(`DROP INDEX "UQ_invoices_tenant_invoice_number"`);
    await q.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "UQ_d8f8d3788694e1b3f96c42c36fb" UNIQUE ("invoice_number")`,
    );
    await q.query(`DROP INDEX "IDX_invoices_tenant_id"`);
    await q.query(`ALTER TABLE "invoices" DROP CONSTRAINT "FK_invoices_tenant"`);
    await q.query(`ALTER TABLE "invoices" DROP COLUMN "tenant_id"`);
  }
}
