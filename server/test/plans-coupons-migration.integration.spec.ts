import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { PlansCouponsRefunds1792200000000 } from '../src/migrations/1792200000000-PlansCouponsRefunds';

const DEFAULT_PLAN_ID = '00000000-0000-4000-8000-000000000001';

/**
 * [100.3.gC-01/#3867] Plans, coupons and refunds: the migration round-trips on a live DB and
 * every CHECK / unique index / RESTRICT FK rejects its bad value. Money is whole paisa, so the
 * discount CHECK has no tolerance. down() then up() runs once in the first test, so every later
 * test (and later spec files) see the tables again.
 */
describe('PlansCouponsRefunds1792200000000 (integration)', () => {
  let ds: DataSource;
  let qr: QueryRunner;
  let schoolId: string;
  const migration = new PlansCouponsRefunds1792200000000();
  const created: { coupons: string[]; plans: string[] } = { coupons: [], plans: [] };

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    ds = module.get(DataSource);
    qr = ds.createQueryRunner();
    const [{ id }] = await ds.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'Plans Migration School', 'plans-mig-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    schoolId = id;
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM "coupon_redemptions" WHERE school_id = $1`, [schoolId]);
    await ds.query(
      `DELETE FROM "platform_payments" WHERE seat_order_id IN (SELECT id FROM "seat_orders" WHERE school_id = $1)`,
      [schoolId],
    );
    await ds.query(`DELETE FROM "seat_orders" WHERE school_id = $1`, [schoolId]);
    await ds.query(`DELETE FROM "coupon_schools" WHERE school_id = $1`, [schoolId]);
    await ds.query(`DELETE FROM "schools" WHERE id = $1`, [schoolId]);
    if (created.coupons.length)
      await ds.query(`DELETE FROM "coupons" WHERE id = ANY($1)`, [created.coupons]);
    if (created.plans.length)
      await ds.query(`DELETE FROM "plans" WHERE id = ANY($1)`, [created.plans]);
    await qr.release();
    await ds.destroy();
  });

  /** Runs `sql` and returns the Postgres error code it raised (or null). */
  async function pgCode(sql: string, params: unknown[] = []): Promise<string | null> {
    try {
      await ds.query(sql, params);
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? 'unknown';
    }
  }

  async function plan(name: string, extra = 'false, true'): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO "plans" (name, unit_price_paisa, is_default, active) VALUES ($1, 500, ${extra.split(',')[0]}, ${extra.split(',')[1]}) RETURNING id`,
      [name],
    );
    created.plans.push(id);
    return id;
  }

  const couponSql = (cols: string, vals: string) =>
    `INSERT INTO "coupons" (code, ${cols}, starts_at, ends_at) VALUES ('C' || upper(substr(gen_random_uuid()::text, 1, 8)),${vals}, now(), now() + interval '1 day') RETURNING id`;

  async function coupon(cols: string, vals: string): Promise<string> {
    const [{ id }] = await ds.query(couponSql(cols, vals));
    created.coupons.push(id);
    return id;
  }

  async function order(amount: number, discount: number): Promise<string> {
    // 2 seats x 3 months x 1000 = 6000 list price.
    const [{ id }] = await ds.query(
      `INSERT INTO "seat_orders" (school_id, seats, months, unit_price_paisa, amount_paisa, discount_paisa, period_start, period_end, status, idempotency_key)
       VALUES ($1, 2, 3, 1000, $2, $3, '2033-01-01', '2033-04-01', 'PENDING', gen_random_uuid()::text) RETURNING id`,
      [schoolId, amount, discount],
    );
    return id;
  }

  it('round-trips (up, down, up) and keeps the default plan, school plan and billing.vat', async () => {
    await migration.down(qr);
    const [{ gone }] = await ds.query(`SELECT to_regclass('plans') IS NULL AS gone`);
    expect(gone).toBe(true);
    await migration.up(qr);

    // Every existing school (the one made before the round-trip too) is on the default plan.
    const rows = await ds.query(`SELECT plan_id FROM "schools" WHERE id = $1`, [schoolId]);
    expect(rows[0].plan_id).toBe(DEFAULT_PLAN_ID);
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM "schools" WHERE plan_id IS DISTINCT FROM $1`,
      [DEFAULT_PLAN_ID],
    );
    expect(n).toBe(0);

    const [std] = await ds.query(`SELECT * FROM "plans" WHERE id = $1`, [DEFAULT_PLAN_ID]);
    expect(std).toMatchObject({
      name: 'Standard',
      unit_price_paisa: 1000,
      active: true,
      is_default: true,
    });
    const [vat] = await ds.query(`SELECT value FROM "platform_settings" WHERE key = 'billing.vat'`);
    expect(vat.value).toMatchObject({ rate_bp: null, label: 'VAT' });
  });

  it('gives a school made after the migration the default plan with no code change', async () => {
    const [{ plan_id }] = await ds.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'New School', 'plans-new-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING plan_id, id`,
    );
    expect(plan_id).toBe(DEFAULT_PLAN_ID);
    await ds.query(`DELETE FROM "schools" WHERE name = 'New School' AND slug LIKE 'plans-new-%'`);
  });

  it('rejects a second default plan (23505)', async () => {
    expect(
      await pgCode(
        `INSERT INTO "plans" (name, unit_price_paisa, is_default) VALUES ('Second Default', 500, true)`,
      ),
    ).toBe('23505');
  });

  it('rejects is_default on an inactive plan (23514)', async () => {
    expect(
      await pgCode(
        `INSERT INTO "plans" (name, unit_price_paisa, is_default, active) VALUES ('Dead Default', 500, true, false)`,
      ),
    ).toBe('23514');
  });

  it('rejects a duplicate plan name ignoring case, and a price outside 1..100000000', async () => {
    expect(
      await pgCode(`INSERT INTO "plans" (name, unit_price_paisa) VALUES ('STANDARD', 500)`),
    ).toBe('23505');
    expect(await pgCode(`INSERT INTO "plans" (name, unit_price_paisa) VALUES ('Free', 0)`)).toBe(
      '23514',
    );
    expect(
      await pgCode(`INSERT INTO "plans" (name, unit_price_paisa) VALUES ('Huge', 100000001)`),
    ).toBe('23514');
  });

  it('rejects a coupon with both percent and fixed, or neither (23514)', async () => {
    expect(
      await pgCode(couponSql('discount_kind, percent, fixed_paisa', `'PERCENT', 10, 500`)),
    ).toBe('23514');
    expect(await pgCode(couponSql('discount_kind', `'PERCENT'`))).toBe('23514');
    // A kind whose value does not match is rejected too.
    expect(await pgCode(couponSql('discount_kind, fixed_paisa', `'PERCENT', 500`))).toBe('23514');
    await coupon('discount_kind, percent', `'PERCENT', 100`);
    expect(await pgCode(couponSql('discount_kind, percent', `'PERCENT', 101`))).toBe('23514');
  });

  it('rejects a lower-case code and an ends_at before starts_at (23514)', async () => {
    expect(
      await pgCode(
        `INSERT INTO "coupons" (code, discount_kind, percent, starts_at, ends_at) VALUES ('lower', 'PERCENT', 5, now(), now() + interval '1 day')`,
      ),
    ).toBe('23514');
    expect(
      await pgCode(
        `INSERT INTO "coupons" (code, discount_kind, percent, starts_at, ends_at) VALUES ('BACKWARDS', 'PERCENT', 5, now(), now() - interval '1 day')`,
      ),
    ).toBe('23514');
  });

  it('rejects uses_count above max_uses, and keeps it from being pushed past max_uses (23514)', async () => {
    expect(
      await pgCode(couponSql('discount_kind, percent, max_uses, uses_count', `'PERCENT', 5, 1, 2`)),
    ).toBe('23514');
    const id = await coupon('discount_kind, percent, max_uses', `'PERCENT', 5, 1`);
    await ds.query(`UPDATE "coupons" SET uses_count = 1 WHERE id = $1`, [id]);
    // A second use cannot be counted: the CHECK is what stops a race from overselling.
    expect(
      await pgCode(`UPDATE "coupons" SET uses_count = uses_count + 1 WHERE id = $1`, [id]),
    ).toBe('23514');
  });

  it('rejects a second redemption for one order (23505)', async () => {
    const couponId = await coupon('discount_kind, percent', `'PERCENT', 10`);
    const orderId = await order(5400, 600);
    const redeem = `INSERT INTO "coupon_redemptions" (coupon_id, school_id, seat_order_id, discount_paisa) VALUES ($1, $2, $3, 600)`;
    await ds.query(redeem, [couponId, schoolId, orderId]);
    expect(await pgCode(redeem, [couponId, schoolId, orderId])).toBe('23505');
  });

  it('discount CHECK: accepts amount = list - discount and rejects any mismatch, even by 1 paisa (23514)', async () => {
    await order(6000, 0); // no coupon: full list price
    await order(5400, 600); // 6000 - 600
    await expect(order(5401, 600)).rejects.toMatchObject({ code: '23514' });
    await expect(order(6000, 600)).rejects.toMatchObject({ code: '23514' });
    await expect(order(6600, -600)).rejects.toMatchObject({ code: '23514' }); // negative discount
  });

  it('blocks deleting a plan or coupon that is still referenced (23001)', async () => {
    expect(await pgCode(`DELETE FROM "plans" WHERE id = $1`, [DEFAULT_PLAN_ID])).toBe('23001');
    const planId = await plan('Referenced Plan');
    const couponId = await coupon('discount_kind, percent', `'PERCENT', 10`);
    await ds.query(`INSERT INTO "coupon_schools" (coupon_id, school_id) VALUES ($1, $2)`, [
      couponId,
      schoolId,
    ]);
    expect(await pgCode(`DELETE FROM "coupons" WHERE id = $1`, [couponId])).toBe('23001');
    expect(await pgCode(`DELETE FROM "schools" WHERE id = $1`, [schoolId])).toBe('23001');
    await ds.query(`UPDATE "schools" SET plan_id = $1 WHERE id = $2`, [planId, schoolId]);
    expect(await pgCode(`DELETE FROM "plans" WHERE id = $1`, [planId])).toBe('23001');
    await ds.query(`UPDATE "schools" SET plan_id = $1 WHERE id = $2`, [DEFAULT_PLAN_ID, schoolId]);
    await ds.query(`DELETE FROM "coupon_schools" WHERE coupon_id = $1`, [couponId]);
  });

  it('lets a lot be marked REFUNDED, and down() turns REFUNDED lots into EXPIRED', async () => {
    const lot = (status: string) =>
      ds.query(
        `INSERT INTO "sms_credit_lots" (tenant_id, source, units_total, remaining, expired_units, status) VALUES ($1, 'MANUAL', 10, 0, 10, $2) RETURNING id`,
        [schoolId, status],
      );
    const [{ id }] = await lot('REFUNDED');
    await expect(lot('BOGUS')).rejects.toMatchObject({ code: '23514' });

    // down() restores the 3-value CHECK, so it first moves REFUNDED lots to EXPIRED.
    await migration.down(qr);
    const [row] = await ds.query(`SELECT status FROM "sms_credit_lots" WHERE id = $1`, [id]);
    expect(row.status).toBe('EXPIRED');
    await expect(lot('REFUNDED')).rejects.toMatchObject({ code: '23514' });
    await migration.up(qr);
    await ds.query(`DELETE FROM "sms_credit_lots" WHERE tenant_id = $1`, [schoolId]);
  });
});
