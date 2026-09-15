import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [16.5.1] Rebuilds `invoices` as a frozen, snapshot-based document:
 *
 * - `kind` (`INVOICE` | `CREDIT_NOTE`) and `related_invoice_id` — a credit
 *   note reverses the invoice it points at.
 * - `payment_id` — the payment an invoice was built from.
 * - `snapshot` (`NOT NULL jsonb`) replaces the old flat `line_items`
 *   column with the whole document: issuer identity, every paying
 *   student's lines (a multi-student/sibling checkout snapshots more than
 *   one), totals, and how the money was received.
 * - `student_fee_id` is dropped — a bill's lines now live inside
 *   `snapshot`, not as a single FK to one `StudentFee` row.
 * - A trigger (D21) enforces immutability: once a row's `status` leaves
 *   `DRAFT`, an `UPDATE` may only change `status`, `updated_at`,
 *   `deleted_at` — every other column, including `snapshot` itself, is
 *   frozen for good.
 *
 * `snapshot` backfills existing rows from their old `line_items` +
 * `issuer_snapshot` columns before the column is dropped, so no existing
 * invoice is left without a document to render.
 */
export class InvoiceImmutableSnapshot1789800008000 implements MigrationInterface {
  name = 'InvoiceImmutableSnapshot1789800008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."invoices_kind_enum" AS ENUM('INVOICE', 'CREDIT_NOTE')`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "kind" "public"."invoices_kind_enum" NOT NULL DEFAULT 'INVOICE'`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" ADD "payment_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_invoices_payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" ADD "related_invoice_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_invoices_related_invoice_id" FOREIGN KEY ("related_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`ALTER TABLE "invoices" ADD "snapshot" jsonb`);
    // Backfill: every existing row becomes a single-student snapshot built
    // from its own `line_items` + `issuer_snapshot` (or an empty issuer
    // object, for the handful of rows that predate 15.5.5) so the column
    // can go `NOT NULL` without losing any pre-existing invoice's content.
    await queryRunner.query(`
      UPDATE "invoices" inv
      SET "snapshot" = jsonb_build_object(
        'issuer', COALESCE(inv."issuer_snapshot", '{}'::jsonb),
        'students', jsonb_build_array(
          jsonb_build_object(
            'id', s."id",
            'full_name', s."full_name",
            'registration_number', s."registration_number",
            'class_name', NULL,
            'lines', COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'fee_name', COALESCE(li->>'description', 'Fee'),
                    'period_label', '',
                    'amount', COALESCE((li->>'amount')::numeric, 0),
                    'discount', 0,
                    'paid_this_time', COALESCE((li->>'total')::numeric, 0),
                    'balance_after', 0
                  )
                )
                FROM jsonb_array_elements(COALESCE(inv."line_items", '[]'::jsonb)) li
              ),
              '[]'::jsonb
            )
          )
        ),
        'totals', jsonb_build_object(
          'billed', inv."total_amount",
          'discount', inv."discount_amount",
          'paid', inv."total_amount",
          'change', 0,
          'wallet_used', 0,
          'wallet_added', 0
        ),
        'payment', jsonb_build_object(
          'method', NULL,
          'reference', NULL,
          'received_by_name', NULL,
          'payment_date', inv."issued_date"
        )
      )
      FROM "students" s
      WHERE s."id" = inv."student_id"
    `);
    await queryRunner.query(`ALTER TABLE "invoices" ALTER COLUMN "snapshot" SET NOT NULL`);

    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "FK_ef57e3b4f3e8f4e1ce5b22fb6a5"`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "student_fee_id"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "line_items"`);

    // [D21] Immutability trigger — once a row's status is no longer
    // 'DRAFT', an UPDATE may only touch status/updated_at/deleted_at.
    // `create()` always issues with status ISSUED, so every checkout
    // invoice is frozen from the instant it's inserted.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "public"."enforce_invoice_immutability"() RETURNS TRIGGER AS $$
      BEGIN
        IF OLD."status" <> 'DRAFT' AND (
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
          NEW."issuer_snapshot" IS DISTINCT FROM OLD."issuer_snapshot" OR
          NEW."created_at" IS DISTINCT FROM OLD."created_at"
        ) THEN
          RAISE EXCEPTION 'invoices is immutable once issued: only status, updated_at, deleted_at may change (id=%)', OLD."id";
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      `CREATE TRIGGER "trg_enforce_invoice_immutability" BEFORE UPDATE ON "invoices" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_invoice_immutability"()`,
    );

    // [B6] At most one live INVOICE-kind document per payment — prevents
    // a race between two concurrent invoice-creation attempts for the
    // same payment from minting two invoices. CREDIT_NOTE rows (which
    // also carry `payment_id`, copied from the original) and soft-deleted
    // rows are excluded so they can't collide with this.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_invoices_payment_id_kind_invoice" ON "invoices" ("payment_id") WHERE "kind" = 'INVOICE' AND "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_invoices_payment_id_kind_invoice"`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_enforce_invoice_immutability" ON "invoices"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS "public"."enforce_invoice_immutability"()`);

    await queryRunner.query(`ALTER TABLE "invoices" ADD "line_items" jsonb`);
    await queryRunner.query(`ALTER TABLE "invoices" ADD "student_fee_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "FK_invoices_student_fee_id" FOREIGN KEY ("student_fee_id") REFERENCES "student_fees"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`
      UPDATE "invoices"
      SET "line_items" = COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'description', line->>'fee_name',
              'amount', (line->>'amount')::numeric,
              'quantity', 1,
              'total', (line->>'paid_this_time')::numeric
            )
          )
          FROM jsonb_array_elements("snapshot"->'students') student,
               jsonb_array_elements(student->'lines') line
        ),
        '[]'::jsonb
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "FK_invoices_related_invoice_id"`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "related_invoice_id"`);
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "FK_invoices_payment_id"`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "payment_id"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "snapshot"`);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "kind"`);
    await queryRunner.query(`DROP TYPE "public"."invoices_kind_enum"`);
  }
}
