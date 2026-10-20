import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [49.19/#1822] `seat_orders.receipt_number`: `SMR-YYYY-NNNNNN`, one platform-wide series, set
 * when an order is paid (NULL while unpaid and for platform GRANTs, which have no receipt).
 * `receipt_snapshot` freezes what the receipt shows (school name, address, VAT registration) at
 * payment time, so a later profile or env change never rewrites a past receipt.
 * Demo seed: the `billing` slice saves its PAID orders directly and sets both columns itself.
 */
export class SeatOrderReceiptNumber1791900000400 implements MigrationInterface {
  name = 'SeatOrderReceiptNumber1791900000400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "seat_orders" ADD "receipt_number" text`);
    await queryRunner.query(`ALTER TABLE "seat_orders" ADD "receipt_snapshot" jsonb`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_seat_orders_receipt_number" ON "seat_orders" ("receipt_number") WHERE "receipt_number" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_seat_orders_receipt_number"`);
    await queryRunner.query(`ALTER TABLE "seat_orders" DROP COLUMN "receipt_number"`);
    await queryRunner.query(`ALTER TABLE "seat_orders" DROP COLUMN "receipt_snapshot"`);
  }
}
