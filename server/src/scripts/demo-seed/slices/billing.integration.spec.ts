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
 ORDER BY o.idempotency_key`;

describe('billing slice (integration)', () => {
  let ds: DataSource;
  let app: TestingModule;

  const run = async () => {
    await ds.query(`DELETE FROM platform_payments`);
    await ds.query(`DELETE FROM seat_orders`);
    await ds.query(`DELETE FROM schools WHERE name LIKE 'bmsc-%'`);
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
    expect(await run()).toBe(6);
    const rows = await ds.query(SUMMARY);
    expect(rows.map((r: { k: string }) => r.k)).toEqual(SLUGS.map((s) => `demo-${s}-1`).sort());
    for (const r of rows) {
      expect(r).toMatchObject({ status: 'PAID', method: 'OFFLINE_BANK', seats: 1400, months: 12 });
      expect(r.amount).toBe(r.paid);
      expect(Number(r.amount)).toBe(1400 * 12 * 1000);
      expect([r.s, r.e]).toEqual(['2026-04-30', '2027-04-30']);
    }
  });

  it('is deterministic for the same anchor', async () => {
    await run();
    const a = await ds.query(SUMMARY);
    await run();
    expect(await ds.query(SUMMARY)).toEqual(a);
  });
});
