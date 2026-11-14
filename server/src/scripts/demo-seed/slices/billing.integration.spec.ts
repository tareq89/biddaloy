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
    await ds.query(`DELETE FROM coupon_schools`);
    await ds.query(`DELETE FROM seat_orders`);
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
    expect(await run()).toBe(14); // 10 orders+payments, 2 coupons, 1 coupon school, 1 plan
    const rows = await ds.query(SUMMARY);
    expect(rows.map((r: { k: string }) => r.k)).toEqual(SLUGS.map((s) => `demo-${s}-1`).sort());
    for (const r of rows) {
      expect(r).toMatchObject({ status: 'PAID', method: 'OFFLINE_BANK', seats: 1400, months: 12 });
      expect(r.amount).toBe(r.paid);
      // The first branch used the 10 percent welcome coupon; the other two paid list price.
      const list = 1400 * 12 * 1000;
      expect(Number(r.amount)).toBe(r.k === 'demo-bmsc-primary-1' ? list * 0.9 : list);
      expect([r.s, r.e]).toEqual(['2026-04-30', '2027-04-30']);
    }
  });

  it('seeds the welcome coupon, its one redemption and the default plan on every order', async () => {
    await run();
    const [c] = await ds.query(
      `SELECT count(*)::int AS coupons,
              (SELECT count(*)::int FROM coupon_redemptions) AS redemptions,
              (SELECT count(*)::int FROM coupon_schools) AS chosen,
              (SELECT count(*)::int FROM seat_orders WHERE plan_id = '00000000-0000-4000-8000-000000000001') AS on_default_plan,
              (SELECT discount_paisa::text FROM coupon_redemptions r JOIN coupons c ON c.id = r.coupon_id WHERE c.code = 'DEMOWELCOME') AS discount
         FROM coupons`,
    );
    expect(c).toEqual({
      coupons: 2,
      redemptions: 2,
      chosen: 1,
      on_default_plan: 4,
      discount: String(1400 * 12 * 100),
    });
  });

  it('seeds the Plus plan, a 50 percent coupon order and a refunded order', async () => {
    await run();
    const rows = await ds.query(
      `SELECT o.status, o.discount_paisa::text AS discount, o.refund_reason, o.refunded_at IS NOT NULL AS refunded,
              o.refunded_by_user_id IS NULL AS no_by, p.name AS plan
         FROM seat_orders o JOIN plans p ON p.id = o.plan_id
        WHERE o.idempotency_key LIKE '%-extra-%' ORDER BY o.idempotency_key`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r: { status: string }) => r.status === 'REFUNDED')).toMatchObject({
      plan: 'Plus',
      refunded: true,
      refund_reason: 'Paid twice by mistake',
    });
    expect(rows.find((r: { status: string }) => r.status === 'PAID').discount).toBe(String((200 * 3 * 1000) / 2));
  });

  it('is deterministic for the same anchor', async () => {
    await run();
    const a = await ds.query(SUMMARY);
    await run();
    expect(await ds.query(SUMMARY)).toEqual(a);
  });
});
