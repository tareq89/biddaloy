import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { createContext } from '../context';
import { slice } from './billing';

// 31 Oct: -6m and +6m both land on 30 Apr, so the spec also covers Postgres month clamping.
const ANCHOR = '2026-10-31';
const SLUGS = ['bmsc-primary', 'bmsc-high', 'bmsc-college'];
const SUMMARY = `SELECT o.idempotency_key AS k, o.seats, o.months, o.status,
       o.amount_paisa::text AS amount, p.amount_paisa::text AS paid, p.method,
       o.period_start::text AS s, o.period_end::text AS e
  FROM seat_orders o JOIN platform_payments p ON p.seat_order_id = o.id
 WHERE o.idempotency_key NOT LIKE '%-extra-%'
 ORDER BY o.idempotency_key`;

describe('billing slice (integration)', () => {
  let ds: DataSource;
  let app: TestingModule;

  const run = async () => {
    await ds.query(`DELETE FROM platform_payments`);
    await ds.query(`DELETE FROM coupon_redemptions`);
    await ds.query(`DELETE FROM seat_orders`);
    await ds.query(`DELETE FROM coupon_schools`);
    await ds.query(`DELETE FROM coupons`);
    await ds.query(`DELETE FROM schools WHERE name LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM plans WHERE name = 'Plus'`);
    const ctx = await createContext({
      ds,
      app,
      scale: 1,
      years: 1,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    const tenants = [];
    for (const slug of SLUGS) {
      const [s] = await ds.query(
        `INSERT INTO schools (name, slug) VALUES ($1::text, $1::text || '-' || substr(gen_random_uuid()::text, 1, 6)) RETURNING id`,
        [slug],
      );
      tenants.push({ id: s.id, slug });
    }
    ctx.ids.set('org', { adminUserId: null, tenants });
    return slice.run(ctx);
  };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
    app = module;
  }, 120_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('writes one PAID order and one matching payment per school around the anchor', async () => {
    expect(await run()).toBe(14);
    const rows = await ds.query(SUMMARY);
    expect(rows.map((r: { k: string }) => r.k)).toEqual(SLUGS.map((s) => `demo-${s}-1`).sort());
    for (const r of rows) {
      expect(r).toMatchObject({ status: 'PAID', method: 'OFFLINE_BANK', seats: 1400, months: 12 });
      expect(r.amount).toBe(r.paid);
      expect(Number(r.amount)).toBe(1400 * 12 * 1000);
      expect([r.s, r.e]).toEqual(['2026-04-30', '2027-04-30']);
    }
  });

  it('adds a second plan, a coupon order with its redemption and a refunded order', async () => {
    await run();
    const [plus] = await ds.query(`SELECT unit_price_paisa AS p FROM plans WHERE name = 'Plus'`);
    expect(plus.p).toBe(1500);
    const [c] = await ds.query(
      `SELECT code, uses_count, scope, (SELECT count(*)::int FROM coupon_schools) AS schools,
              (SELECT count(*)::int FROM coupon_redemptions) AS redemptions FROM coupons`,
    );
    expect(c).toMatchObject({
      code: 'DEMO-HALF',
      uses_count: 1,
      scope: 'SCHOOLS',
      schools: 1,
      redemptions: 1,
    });
    const orders = await ds.query(
      `SELECT status, discount_paisa::text AS discount, amount_paisa::text AS amount,
              (coupon_id IS NOT NULL) AS has_coupon, refunded_at IS NOT NULL AS refunded
         FROM seat_orders WHERE idempotency_key LIKE '%-extra-%' ORDER BY (coupon_id IS NULL)`,
    );
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({
      status: 'PAID',
      has_coupon: true,
      discount: '300000',
      amount: '300000',
    });
    expect(orders[1]).toMatchObject({ status: 'REFUNDED', has_coupon: false, refunded: true });
  });

  it('is deterministic for the same anchor', async () => {
    await run();
    const a = await ds.query(SUMMARY);
    await run();
    expect(await ds.query(SUMMARY)).toEqual(a);
  });
});
