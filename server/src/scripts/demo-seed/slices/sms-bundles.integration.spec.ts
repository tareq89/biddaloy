import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { createContext } from '../context';
import { slice } from './sms-bundles';

const ANCHOR = '2026-10-31';
const SLUGS = ['smsb-primary', 'smsb-high', 'smsb-college'];
/** What `comms-print` would have left behind per school. */
const START_BALANCE = 120;
const SUMMARY = `SELECT o.idempotency_key AS k, o.receipt_number AS r, o.status, o.paid_at::text AS paid,
       l.expires_at::text AS expires, l.units_total
  FROM sms_bundle_orders o JOIN sms_credit_lots l ON l.bundle_order_id = o.id
 ORDER BY o.idempotency_key`;

describe('sms-bundles slice (integration)', () => {
  let ds: DataSource;
  let app: TestingModule;

  const run = async () => {
    await ds.query(`DELETE FROM platform_payments WHERE bundle_order_id IS NOT NULL`);
    await ds.query(`DELETE FROM sms_credit_lots`);
    await ds.query(`DELETE FROM sms_bundle_orders`);
    await ds.query(`DELETE FROM sms_stock_entries`);
    await ds.query(`DELETE FROM sms_provider_balance_readings`);
    await ds.query(`DELETE FROM sms_bundle_catalog`);
    await ds.query(`DELETE FROM schools WHERE name LIKE 'smsb-%'`);
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
      await ds.query(
        `INSERT INTO sms_credit_balance (tenant_id, available, reserved) VALUES ($1, $2, 0)`,
        [s.id, START_BALANCE],
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

  it('keeps balance.available equal to the sum of lot remaining, counters add up', async () => {
    await run();
    const rows = await ds.query(
      `SELECT b.available, COALESCE(SUM(l.remaining), 0)::int AS lots
         FROM sms_credit_balance b JOIN schools s ON s.id = b.tenant_id AND s.name LIKE 'smsb-%'
         LEFT JOIN sms_credit_lots l ON l.tenant_id = b.tenant_id
        GROUP BY b.tenant_id, b.available`,
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.available).toBe(START_BALANCE + 5000);
      expect(r.lots).toBe(r.available);
    }
    const bad = await ds.query(
      `SELECT 1 FROM sms_credit_lots
        WHERE remaining + reserved_units + debited_units + expired_units <> units_total`,
    );
    expect(bad).toHaveLength(0);
  });

  it('writes a legacy lot, an expiring bundle lot, receipts in the real shape and one-of payments', async () => {
    await run();
    expect(await ds.query(`SELECT 1 FROM sms_bundle_catalog WHERE active`)).toHaveLength(3);
    const rows = await ds.query(SUMMARY);
    expect(rows).toHaveLength(3);
    // Unique receipt numbers after billing's SMR-<year>-000001..3.
    expect(rows.map((r: { r: string }) => r.r)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^SMR-\d{4}-00000[4-6]$/)]),
    );
    expect(new Set(rows.map((r: { r: string }) => r.r)).size).toBe(3);
    const [{ ok }] = await ds.query(
      `SELECT bool_and(l.expires_at = o.paid_at + make_interval(days => o.validity_days)) AS ok
         FROM sms_bundle_orders o JOIN sms_credit_lots l ON l.bundle_order_id = o.id`,
    );
    expect(ok).toBe(true);
    const legacy = await ds.query(
      `SELECT 1 FROM sms_credit_lots WHERE source = 'LEGACY' AND expires_at IS NULL AND units_total = $1`,
      [START_BALANCE],
    );
    expect(legacy).toHaveLength(3);
    const pay = await ds.query(
      `SELECT method, seat_order_id FROM platform_payments WHERE bundle_order_id IS NOT NULL`,
    );
    expect(pay).toHaveLength(3);
    for (const p of pay) expect(p).toMatchObject({ method: 'OFFLINE_BANK', seat_order_id: null });
    expect(await ds.query(`SELECT 1 FROM sms_stock_entries`)).toHaveLength(1);
    expect(await ds.query(`SELECT 1 FROM sms_provider_balance_readings`)).toHaveLength(1);
  });

  it('is repeatable on a fresh database with the same anchor', async () => {
    await run();
    const a = (await ds.query(SUMMARY)).map(
      ({ k, r, status, paid, expires, units_total }: never) => ({
        k,
        r,
        status,
        paid,
        expires,
        units_total,
      }),
    );
    await run();
    const b = (await ds.query(SUMMARY)).map(
      ({ k, r, status, paid, expires, units_total }: never) => ({
        k,
        r,
        status,
        paid,
        expires,
        units_total,
      }),
    );
    expect(b).toEqual(a);
  });
});
