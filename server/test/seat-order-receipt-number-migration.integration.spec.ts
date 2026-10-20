import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { SeatOrderReceiptNumber1791900000400 } from '../src/migrations/1791900000400-SeatOrderReceiptNumber';

/**
 * [49.19/#1822] Orders paid before the receipt migration (bKash / offline shipped first) get a
 * number in the same SMR-YYYY-NNNNNN series, by paid_at per Asia/Dhaka year. down() then up() in
 * one test so later specs see the columns again. Years 2031/2032 keep clear of other test data.
 */
describe('SeatOrderReceiptNumber1791900000400 backfill (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  let schoolId: string;
  const migration = new SeatOrderReceiptNumber1791900000400();

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
    const [{ id }] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug, address) VALUES (gen_random_uuid(), 'Receipt Backfill School', 'receipt-backfill-' || substr(gen_random_uuid()::text, 1, 8), 'Dhaka 1207') RETURNING id`,
    );
    schoolId = id;
  }, 60000);

  afterAll(async () => {
    await dataSource.query(
      `DELETE FROM "platform_payments" WHERE seat_order_id IN (SELECT id FROM "seat_orders" WHERE school_id = $1)`,
      [schoolId],
    );
    await dataSource.query(`DELETE FROM "seat_orders" WHERE school_id = $1`, [schoolId]);
    await dataSource.query(`DELETE FROM "schools" WHERE id = $1`, [schoolId]);
    await queryRunner.release();
    await dataSource.destroy();
  });

  /** An order, paid at `paidAt` (or PENDING when null), with one payment row of `method`. */
  async function order(paidAt: string | null, method: string | null, raw: object | null = null) {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "seat_orders" (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key, paid_at)
       VALUES ($1, 1, 1, 1000, 1000, '2031-01-01', '2031-02-01', $2, gen_random_uuid()::text, $3) RETURNING id`,
      [schoolId, paidAt ? 'PAID' : 'PENDING', paidAt],
    );
    if (method) {
      await dataSource.query(
        `INSERT INTO "platform_payments" (seat_order_id, method, gateway_ref, amount_paisa, raw) VALUES ($1, $2, gen_random_uuid()::text, 1000, $3)`,
        [id, method, raw ? JSON.stringify(raw) : null],
      );
    }
    return id as string;
  }

  async function receipt(id: string) {
    const [row] = await dataSource.query(
      `SELECT receipt_number, receipt_snapshot FROM "seat_orders" WHERE id = $1`,
      [id],
    );
    return row as { receipt_number: string | null; receipt_snapshot: { name: string } | null };
  }

  it('numbers paid bKash/offline orders by paid_at per Dhaka year, skips the rest, and is idempotent', async () => {
    // 17:00 UTC on 31 Dec is 23:00 in Dhaka (still 2031); 18:30 UTC is 00:30 on 1 Jan 2032.
    const late2031 = await order('2031-12-31T17:00:00Z', 'OFFLINE_BANK');
    const second2032 = await order('2032-02-01T06:00:00Z', 'BKASH');
    const first2032 = await order('2031-12-31T18:30:00Z', 'OFFLINE_CASH');
    const grant = await order('2031-06-01T06:00:00Z', 'GRANT');
    const pending = await order(null, null);
    const orphanOnly = await order('2031-07-01T06:00:00Z', 'BKASH', { orphan: true });

    await migration.down(queryRunner);
    await migration.up(queryRunner);

    expect((await receipt(late2031)).receipt_number).toBe('SMR-2031-000001');
    expect((await receipt(first2032)).receipt_number).toBe('SMR-2032-000001');
    expect((await receipt(second2032)).receipt_number).toBe('SMR-2032-000002');
    // The snapshot is built from the school as it is now.
    expect((await receipt(late2031)).receipt_snapshot).toMatchObject({
      name: 'Receipt Backfill School',
      address: 'Dhaka 1207',
    });
    // A GRANT is not a sale, an unpaid order has nothing to receipt, an orphan is not the payment.
    for (const id of [grant, pending, orphanOnly]) {
      expect((await receipt(id)).receipt_number).toBeNull();
    }

    // A second run changes nothing; a newly found order continues the year's series.
    await SeatOrderReceiptNumber1791900000400.backfill(queryRunner);
    expect((await receipt(second2032)).receipt_number).toBe('SMR-2032-000002');
    const third2032 = await order('2032-03-01T06:00:00Z', 'OFFLINE_CASH');
    await dataSource.query(`UPDATE "seat_orders" SET receipt_number = NULL WHERE id = $1`, [
      third2032,
    ]);
    await SeatOrderReceiptNumber1791900000400.backfill(queryRunner);
    expect((await receipt(third2032)).receipt_number).toBe('SMR-2032-000003');
  });
});
