import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { SmsLots1792150000000 } from '../src/migrations/1792150000000-SmsLots';
import { PlansCouponsRefunds1792200000000 } from '../src/migrations/1792200000000-PlansCouponsRefunds';

/**
 * [100.1.02/#3851] up/down/up of the SMS lots migration, the D27 backfill, every CHECK, and RESTRICT.
 * Ends with the migration applied so later specs on this worker see the tables.
 */
describe('SmsLots1792150000000 (integration)', () => {
  let ds: DataSource;
  let qr: QueryRunner;
  let schoolId: string;
  const migration = new SmsLots1792150000000();
  // Runs after SmsLots (adds sms_bundle_orders.refunded_by_user_id, REFUNDED lots), so a round-trip
  // of SmsLots must roll it back first and re-apply it last, or later specs see a half-migrated schema.
  const dependent = new PlansCouponsRefunds1792200000000();

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    ds = module.get(DataSource);
    qr = ds.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    await qr.release();
    await ds.destroy();
  });

  beforeEach(async () => {
    const [{ id }] = await ds.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'Lots Test School', 'lots-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    schoolId = id;
  });

  afterEach(async () => {
    await ds.query(
      `DELETE FROM "platform_payments" WHERE bundle_order_id IN (SELECT id FROM sms_bundle_orders WHERE school_id = $1)`,
      [schoolId],
    );
    await ds.query(`DELETE FROM "sms_credit_lot_draws" WHERE tenant_id = $1`, [schoolId]);
    await ds.query(`DELETE FROM "sms_credit_lots" WHERE tenant_id = $1`, [schoolId]);
    await ds.query(`DELETE FROM "sms_bundle_orders" WHERE school_id = $1`, [schoolId]);
    await ds.query(`DELETE FROM "sms_credit_balance" WHERE tenant_id = $1`, [schoolId]);
    await ds.query(`DELETE FROM "schools" WHERE id = $1`, [schoolId]);
  });

  async function newCatalog(): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO sms_bundle_catalog (name, sms_count, validity_days, price_paisa) VALUES ('Pkg ' || gen_random_uuid(), 1000, 30, 50000) RETURNING id`,
    );
    return id;
  }
  async function newOrder(key = 'k1'): Promise<string> {
    const catalogId = await newCatalog();
    const [{ id }] = await ds.query(
      `INSERT INTO sms_bundle_orders (school_id, catalog_id, name_snapshot, sms_count, validity_days, price_paisa, status, idempotency_key)
       VALUES ($1, $2, 'Pkg', 1000, 30, 50000, 'PENDING_PAYMENT', $3) RETURNING id`,
      [schoolId, catalogId, key],
    );
    return id;
  }
  async function newSeatOrder(): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key)
       VALUES ($1, 1, 1, 1000, 1000, '2027-01-01', '2027-02-01', 'PENDING', 'seat-' || gen_random_uuid()) RETURNING id`,
      [schoolId],
    );
    return id;
  }
  const insertPayment = (seat: string | null, bundle: string | null) =>
    ds.query(
      `INSERT INTO platform_payments (seat_order_id, bundle_order_id, method, amount_paisa) VALUES ($1, $2, 'OFFLINE_CASH', 100)`,
      [seat, bundle],
    );
  const insertLot = (cols: string, vals: unknown[]) =>
    ds.query(
      `INSERT INTO sms_credit_lots (tenant_id, ${cols}) VALUES ($1, ${vals.map((_, i) => `$${i + 2}`).join(', ')})`,
      [schoolId, ...vals],
    );
  const tableCount = async () =>
    Number(
      (
        await ds.query(
          `SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('sms_credit_lots','sms_credit_lot_draws','sms_bundle_catalog','sms_bundle_orders','sms_stock_entries','sms_provider_balance_readings')`,
        )
      )[0].n,
    );

  it('down() drops the six tables, up() re-creates them (up/down/up)', async () => {
    expect(await tableCount()).toBe(6);
    await dependent.down(qr);
    await migration.down(qr);
    expect(await tableCount()).toBe(0);
    await migration.up(qr);
    await dependent.up(qr);
    expect(await tableCount()).toBe(6);
    // The dependent migration's changes are back.
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'sms_bundle_orders' AND column_name = 'refunded_by_user_id'`,
    );
    expect(n).toBe(1);
  });

  it('adds the 18 audit values and the two ledger kinds and reference types', async () => {
    const labels = async (type: string): Promise<string[]> =>
      (
        await ds.query(
          `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1`,
          [type],
        )
      ).map((r: { enumlabel: string }) => r.enumlabel);
    const audit = await labels('audit_logs_action_enum');
    for (const l of [
      'SMS_BUNDLE_CREATED',
      'SMS_SOURCE_CHANGED',
      'PLAN_ASSIGNED',
      'COUPON_REDEEMED',
      'ORDER_REFUNDED',
      'PLATFORM_VAT_CHANGED',
    ]) {
      expect(audit).toContain(l);
    }
    expect(
      audit.filter((l) =>
        /^(SMS_(BUNDLE|STOCK|SOURCE)|PLAN_|COUPON_|ORDER_REFUNDED|PLATFORM_VAT)/.test(l),
      ),
    ).toHaveLength(18);
    expect(await labels('sms_credit_ledger_kind_enum')).toEqual(
      expect.arrayContaining(['PURCHASE', 'EXPIRE']),
    );
    expect(await labels('sms_credit_ledger_reference_type_enum')).toEqual(
      expect.arrayContaining(['bundle_order', 'lot']),
    );
  });

  it('backfill: one lot per funded balance, sums to the balance, one legacy draw, idempotent', async () => {
    await ds.query(
      `INSERT INTO sms_credit_balance (tenant_id, available, reserved) VALUES ($1, 70, 30)`,
      [schoolId],
    );
    await SmsLots1792150000000.backfill(qr);
    await SmsLots1792150000000.backfill(qr); // second run changes nothing
    const lots = await ds.query(`SELECT * FROM sms_credit_lots WHERE tenant_id = $1`, [schoolId]);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      source: 'LEGACY',
      units_total: 100,
      remaining: 70,
      reserved_units: 30,
      expires_at: null,
      status: 'ACTIVE',
      bundle_order_id: null,
    });
    const draws = await ds.query(`SELECT * FROM sms_credit_lot_draws WHERE tenant_id = $1`, [
      schoolId,
    ]);
    expect(draws).toHaveLength(1);
    expect(draws[0]).toMatchObject({
      reserve_key: `legacy:${schoolId}`,
      units: 30,
      open_units: 30,
    });
    // the balance row is untouched
    const [bal] = await ds.query(
      `SELECT available, reserved FROM sms_credit_balance WHERE tenant_id = $1`,
      [schoolId],
    );
    expect(bal).toEqual({ available: 70, reserved: 30 });
  });

  it('backfill skips an empty balance and makes no draw when nothing is reserved', async () => {
    await ds.query(
      `INSERT INTO sms_credit_balance (tenant_id, available, reserved) VALUES ($1, 0, 0)`,
      [schoolId],
    );
    await SmsLots1792150000000.backfill(qr);
    expect(
      await ds.query(`SELECT 1 FROM sms_credit_lots WHERE tenant_id = $1`, [schoolId]),
    ).toHaveLength(0);
    await ds.query(`UPDATE sms_credit_balance SET available = 5 WHERE tenant_id = $1`, [schoolId]);
    await SmsLots1792150000000.backfill(qr);
    expect(
      await ds.query(`SELECT 1 FROM sms_credit_lot_draws WHERE tenant_id = $1`, [schoolId]),
    ).toHaveLength(0);
  });

  it('lot CHECKs: sum, counters, total, bundle link', async () => {
    // counters do not add up to the total -> 23514
    await expect(
      insertLot(`source, units_total, remaining`, ['MANUAL', 10, 9]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertLot(`source, units_total, remaining, reserved_units, debited_units`, [
        'MANUAL',
        10,
        15,
        0,
        -5,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertLot(`source, units_total, remaining`, ['MANUAL', 0, 0]),
    ).rejects.toMatchObject({ code: '23514' });
    // BUNDLE needs an order; MANUAL must not have one
    await expect(
      insertLot(`source, units_total, remaining`, ['BUNDLE', 10, 10]),
    ).rejects.toMatchObject({ code: '23514' });
    const orderId = await newOrder();
    await expect(
      insertLot(`source, units_total, remaining, bundle_order_id`, ['MANUAL', 10, 10, orderId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertLot(`source, units_total, remaining, bundle_order_id`, ['BUNDLE', 10, 10, orderId]),
    ).resolves.toBeDefined();
    // one lot per order
    await expect(
      insertLot(`source, units_total, remaining, bundle_order_id`, ['BUNDLE', 10, 10, orderId]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      insertLot(`source, units_total, remaining, reserved_units, debited_units, expired_units`, [
        'MANUAL',
        10,
        1,
        2,
        3,
        4,
      ]),
    ).resolves.toBeDefined();
  });

  it('draw CHECKs and unique (tenant, reserve_key, lot)', async () => {
    await insertLot(`source, units_total, remaining`, ['MANUAL', 10, 10]);
    const [{ id: lotId }] = await ds.query(`SELECT id FROM sms_credit_lots WHERE tenant_id = $1`, [
      schoolId,
    ]);
    const draw = (units: number, open: number) =>
      ds.query(
        `INSERT INTO sms_credit_lot_draws (tenant_id, lot_id, reserve_key, units, open_units) VALUES ($1, $2, 'rk', $3, $4)`,
        [schoolId, lotId, units, open],
      );
    await expect(draw(0, 0)).rejects.toMatchObject({ code: '23514' });
    await expect(draw(5, 6)).rejects.toMatchObject({ code: '23514' });
    await expect(draw(5, -1)).rejects.toMatchObject({ code: '23514' });
    await expect(draw(5, 5)).resolves.toBeDefined();
    await expect(draw(5, 5)).rejects.toMatchObject({ code: '23505' });
  });

  it('catalog and order CHECKs (count, validity, whole-paisa money cap, status)', async () => {
    const cat = (count: number, days: number, price: number) =>
      ds.query(
        `INSERT INTO sms_bundle_catalog (name, sms_count, validity_days, price_paisa) VALUES ('c' || gen_random_uuid(), $1, $2, $3)`,
        [count, days, price],
      );
    await expect(cat(99, 30, 1)).rejects.toMatchObject({ code: '23514' });
    await expect(cat(1_000_001, 30, 1)).rejects.toMatchObject({ code: '23514' });
    await expect(cat(100, 0, 1)).rejects.toMatchObject({ code: '23514' });
    await expect(cat(100, 366, 1)).rejects.toMatchObject({ code: '23514' });
    await expect(cat(100, 30, 10_000_000_000)).rejects.toMatchObject({ code: '23514' });
    await expect(cat(100, 30, 9_999_999_999)).resolves.toBeDefined();
    const catalogId = await newCatalog();
    await expect(
      ds.query(
        `INSERT INTO sms_bundle_orders (school_id, catalog_id, name_snapshot, sms_count, validity_days, price_paisa, status, idempotency_key) VALUES ($1, $2, 'p', 100, 30, 1, 'BOGUS', 'x')`,
        [schoolId, catalogId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('active package names are unique case-insensitively; inactive ones may repeat', async () => {
    const ins = (name: string, active: boolean) =>
      ds.query(
        `INSERT INTO sms_bundle_catalog (name, sms_count, validity_days, price_paisa, active) VALUES ($1, 100, 30, 1, $2)`,
        [name, active],
      );
    const n = `Dup ${Date.now()}`;
    await ins(n, true);
    await expect(ins(n.toUpperCase(), true)).rejects.toMatchObject({ code: '23505' });
    await expect(ins(n, false)).resolves.toBeDefined();
  });

  it('stock and provider-balance CHECKs', async () => {
    const stock = (count: number, cost: number) =>
      ds.query(
        `INSERT INTO sms_stock_entries (bought_on, sms_count, cost_paisa) VALUES ('2027-01-01', $1, $2)`,
        [count, cost],
      );
    await expect(stock(0, 1)).rejects.toMatchObject({ code: '23514' });
    await expect(stock(1, -1)).rejects.toMatchObject({ code: '23514' });
    await expect(stock(1, 0)).resolves.toBeDefined();
    await expect(
      ds.query(`INSERT INTO sms_provider_balance_readings (sms_balance) VALUES (-1)`),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      ds.query(`INSERT INTO sms_provider_balance_readings (sms_balance) VALUES (0)`),
    ).resolves.toBeDefined();
    await ds.query(`DELETE FROM sms_stock_entries`);
    await ds.query(`DELETE FROM sms_provider_balance_readings`);
  });

  it('payment CHECK: both null and both set are rejected, one side is accepted', async () => {
    const seat = await newSeatOrder();
    const bundle = await newOrder('pay');
    await expect(insertPayment(null, null)).rejects.toMatchObject({ code: '23514' });
    await expect(insertPayment(seat, bundle)).rejects.toMatchObject({ code: '23514' });
    await expect(insertPayment(seat, null)).resolves.toBeDefined();
    await expect(insertPayment(null, bundle)).resolves.toBeDefined();
    await ds.query(`DELETE FROM platform_payments WHERE seat_order_id = $1`, [seat]);
    await ds.query(`DELETE FROM seat_orders WHERE id = $1`, [seat]);
  });

  it('ON DELETE RESTRICT (SQLSTATE 23001): a school with a bundle order, and a lot with a draw, cannot be deleted', async () => {
    const orderId = await newOrder('r1');
    await expect(ds.query(`DELETE FROM schools WHERE id = $1`, [schoolId])).rejects.toMatchObject({
      code: '23001',
    });
    await insertLot(`source, units_total, remaining, bundle_order_id`, ['BUNDLE', 10, 10, orderId]);
    await expect(
      ds.query(`DELETE FROM sms_bundle_orders WHERE id = $1`, [orderId]),
    ).rejects.toMatchObject({ code: '23001' });
    const [{ id: lotId }] = await ds.query(`SELECT id FROM sms_credit_lots WHERE tenant_id = $1`, [
      schoolId,
    ]);
    await ds.query(
      `INSERT INTO sms_credit_lot_draws (tenant_id, lot_id, reserve_key, units, open_units) VALUES ($1, $2, 'k', 1, 1)`,
      [schoolId, lotId],
    );
    await expect(
      ds.query(`DELETE FROM sms_credit_lots WHERE id = $1`, [lotId]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('down() refuses while a bundle payment exists (seat_order_id would be NULL)', async () => {
    const bundle = await newOrder('dn');
    await insertPayment(null, bundle);
    await expect(migration.down(qr)).rejects.toThrow(/bundle payments exist/);
  });
});
