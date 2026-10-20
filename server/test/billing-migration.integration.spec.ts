import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { Billing1791900000350 } from '../src/migrations/1791900000350-Billing';
import { assertProductionConfig, billingFreeUntil } from '../src/config/env.validation';

/**
 * [49.4/#1818] Runs the billing migration's up/down against the migrated test
 * database. down() then up() in one test so later specs see the tables again.
 */
describe('Billing1791900000350 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  let schoolId: string;
  const migration = new Billing1791900000350();

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'Billing Test School', 'billing-test-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    schoolId = id;
  });

  afterEach(async () => {
    // RESTRICT FKs: payments, then orders, must go before the school.
    await dataSource.query(
      `DELETE FROM "platform_payments" WHERE seat_order_id IN (SELECT id FROM "seat_orders" WHERE school_id = $1)`,
      [schoolId],
    );
    await dataSource.query(`DELETE FROM "seat_orders" WHERE school_id = $1`, [schoolId]);
    await dataSource.query(`DELETE FROM "schools" WHERE id = $1`, [schoolId]);
  });

  async function tableNames(): Promise<string[]> {
    const rows: Array<{ table_name: string }> = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('seat_orders', 'platform_payments')`,
    );
    return rows.map((r) => r.table_name).sort();
  }

  function insertOrder(over: { seats?: number; months?: number; amount?: number; key?: string }) {
    return dataSource.query(
      `INSERT INTO "seat_orders" (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key)
       VALUES ($1, $2, $3, 1000, $4, '2027-01-01', '2027-02-01', 'PENDING', $5) RETURNING id`,
      [schoolId, over.seats ?? 10, over.months ?? 1, over.amount ?? 10000, over.key ?? 'k1'],
    );
  }

  it('down() drops both tables, up() re-creates them', async () => {
    expect(await tableNames()).toEqual(['platform_payments', 'seat_orders']);
    await migration.down(queryRunner);
    expect(await tableNames()).toEqual([]);
    await migration.up(queryRunner);
    expect(await tableNames()).toEqual(['platform_payments', 'seat_orders']);
  });

  it('rejects seats < 1, months outside 1-24 and amounts over MONEY_MAX (in paisa)', async () => {
    await expect(insertOrder({ seats: 0 })).rejects.toThrow();
    await expect(insertOrder({ months: 0 })).rejects.toThrow();
    await expect(insertOrder({ months: 25 })).rejects.toThrow();
    await expect(insertOrder({ amount: 10_000_000_000 })).rejects.toThrow();
    await expect(insertOrder({ months: 24, amount: 9_999_999_999 })).resolves.toBeDefined();
  });

  it('unique (school_id, idempotency_key): replay is rejected', async () => {
    await insertOrder({ key: 'dup' });
    await expect(insertOrder({ key: 'dup' })).rejects.toThrow();
  });

  it('(method, gateway_ref) is unique when set; other methods may reuse a ref; many NULLs allowed', async () => {
    const [{ id: o1 }] = await insertOrder({ key: 'a' });
    const ins = (ref: string | null, method = 'BKASH') =>
      dataSource.query(
        `INSERT INTO "platform_payments" (seat_order_id, method, gateway_ref, amount_paisa) VALUES ($1, $3, $2, 100)`,
        [o1, ref, method],
      );
    await ins('trx-1');
    await expect(ins('trx-1')).rejects.toThrow();
    await expect(ins('trx-1', 'OFFLINE_BANK')).resolves.toBeDefined();
    await ins(null);
    await expect(ins(null)).resolves.toBeDefined();
  });

  it('a school with seat orders cannot be deleted (money survives, ON DELETE RESTRICT)', async () => {
    await insertOrder({ key: 'keep' });
    await expect(
      dataSource.query(`DELETE FROM "schools" WHERE id = $1`, [schoolId]),
    ).rejects.toThrow();
  });
});

describe('BILLING_FREE_UNTIL config (49.4)', () => {
  it('defaults to 2027-01-01T00:00+06:00', () => {
    expect(billingFreeUntil('').toISOString()).toBe('2026-12-31T18:00:00.000Z');
  });

  it('production boot refuses an unparsable value', () => {
    expect(() =>
      assertProductionConfig({ NODE_ENV: 'production', BILLING_FREE_UNTIL: '2027-01-01' }),
    ).toThrow(/BILLING_FREE_UNTIL/);
  });
});
