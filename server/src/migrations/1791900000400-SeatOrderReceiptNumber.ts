import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [49.19/#1822] `seat_orders.receipt_number`: `SMR-YYYY-NNNNNN`, one platform-wide series, set
 * when an order is paid (NULL while unpaid and for platform GRANTs, which have no receipt).
 * `receipt_snapshot` freezes what the receipt shows (school name, address, VAT registration) at
 * payment time, so a later profile or env change never rewrites a past receipt.
 * Demo seed: the `billing` slice saves its PAID orders directly and sets both columns itself.
 *
 * Backfill: orders paid by bKash or offline before this ran (if #1820/#1821 deployed first) get a
 * number too, in `paid_at` order per Asia/Dhaka year, after any number that year already has, with
 * a snapshot of the school as it is now. GRANT-only and unpaid orders stay NULL. Only NULL rows are
 * touched, so a second run changes nothing.
 */
export class SeatOrderReceiptNumber1791900000400 implements MigrationInterface {
  name = 'SeatOrderReceiptNumber1791900000400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "seat_orders" ADD "receipt_number" text`);
    await queryRunner.query(`ALTER TABLE "seat_orders" ADD "receipt_snapshot" jsonb`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_seat_orders_receipt_number" ON "seat_orders" ("receipt_number") WHERE "receipt_number" IS NOT NULL`,
    );
    await SeatOrderReceiptNumber1791900000400.backfill(queryRunner);
  }

  /** Same shape and series as `nextReceiptNumber` (receipt-number.util.ts). */
  static async backfill(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `WITH todo AS (
         SELECT o.id, to_char(o.paid_at AT TIME ZONE 'Asia/Dhaka', 'YYYY') AS y, o.paid_at
           FROM seat_orders o
          WHERE o.status = 'PAID' AND o.receipt_number IS NULL AND o.paid_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM platform_payments p
                         WHERE p.seat_order_id = o.id AND p.method <> 'GRANT'
                           AND (p.raw->>'orphan') IS DISTINCT FROM 'true')
       ), numbered AS (
         SELECT t.id, t.y,
                row_number() OVER (PARTITION BY t.y ORDER BY t.paid_at, t.id)
                + coalesce((SELECT max(substring(x.receipt_number from '[0-9]+$')::bigint)
                              FROM seat_orders x
                             WHERE x.receipt_number ~ ('^SMR-' || t.y || '-[0-9]{1,15}$')), 0) AS k
           FROM todo t
       )
       UPDATE seat_orders o
          SET receipt_number = 'SMR-' || n.y || '-' || lpad(n.k::text, greatest(6, length(n.k::text)), '0'),
              receipt_snapshot = jsonb_build_object('name', s.name, 'address', s.address, 'vat', $1::text)
         FROM numbered n, schools s
        WHERE o.id = n.id AND s.id = o.school_id`,
      [process.env.BILLING_VAT_REGISTRATION?.trim() || null],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_seat_orders_receipt_number"`);
    await queryRunner.query(`ALTER TABLE "seat_orders" DROP COLUMN "receipt_number"`);
    await queryRunner.query(`ALTER TABLE "seat_orders" DROP COLUMN "receipt_snapshot"`);
  }
}
