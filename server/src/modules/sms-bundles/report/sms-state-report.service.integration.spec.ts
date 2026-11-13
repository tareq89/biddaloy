import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SmsAllocationService } from '../stock/sms-allocation.service';
import { SmsStateReportService } from './sms-state-report.service';

describe('SmsStateReportService (integration)', () => {
  let ds: DataSource;
  let svc: SmsStateReportService;
  let catalogId: string;
  const schools: string[] = [];

  const reader = { read: async () => ({ sms: null, source: 'UNKNOWN', asOf: null, stale: false }) };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    svc = new SmsStateReportService(
      ds,
      reader as never,
      new SmsAllocationService(ds, reader as never, {} as never),
    );
  }, 60000);

  // the global reset empties tables between tests, so the catalog is seeded per test
  beforeEach(async () => {
    [{ id: catalogId }] = await ds.query(
      `INSERT INTO sms_bundle_catalog (name, sms_count, validity_days, price_paisa, active, sort_order)
       VALUES ('Rep', 100, 30, 5000, true, 1) RETURNING id`,
    );
  });

  afterAll(async () => {
    if (!ds) return;
    for (const id of schools) {
      await ds.query(`DELETE FROM communication_logs WHERE tenant_id = $1`, [id]);
      await ds.query(`DELETE FROM sms_credit_ledger WHERE tenant_id = $1`, [id]);
      await ds.query(`DELETE FROM sms_credit_lots WHERE tenant_id = $1`, [id]);
      await ds.query(`DELETE FROM sms_bundle_orders WHERE school_id = $1`, [id]);
      await ds.query(`DELETE FROM schools WHERE id = $1`, [id]);
    }
    await ds.query(`DELETE FROM sms_stock_entries WHERE note = 'rep-spec'`);
    await ds.destroy();
  });

  const school = async (name: string, metered = false): Promise<string> => {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (id, name, slug, settings)
       VALUES (gen_random_uuid(), $1, 'rep-' || substr(gen_random_uuid()::text,1,8), $2::jsonb) RETURNING id`,
      [name, JSON.stringify(metered ? { communications: { sms: { metering: 'PLATFORM' } } } : {})],
    );
    schools.push(id);
    return id;
  };
  const order = (
    school: string,
    o: { status: string; sms: number; price: number; cost: number | null; paid?: boolean },
  ) =>
    ds.query(
      `INSERT INTO sms_bundle_orders (school_id, catalog_id, name_snapshot, sms_count, validity_days,
         price_paisa, cost_paisa_per_sms, status, idempotency_key, paid_at)
       VALUES ($1,$2,'Rep',$3,30,$4,$5,$6,gen_random_uuid()::text,$7)`,
      [school, catalogId, o.sms, o.price, o.cost, o.status, o.paid === false ? null : new Date()],
    );
  const ledger = (tenant: string, kind: string, units: number) =>
    ds.query(
      `INSERT INTO sms_credit_ledger (tenant_id, kind, units, reference_type, idempotency_key)
       VALUES ($1,$2,$3,'manual',gen_random_uuid()::text)`,
      [tenant, kind, units],
    );
  const lot = (tenant: string, remaining: number, expiresAt: Date) =>
    ds.query(
      `INSERT INTO sms_credit_lots (tenant_id, source, units_total, remaining, reserved_units,
         debited_units, expired_units, expires_at, status)
       VALUES ($1,'MANUAL',$2,$2,0,0,0,$3,'ACTIVE')`,
      [tenant, remaining, expiresAt],
    );

  it('reconciles whole paisa and SMS with the seeded orders, stock and ledger', async () => {
    const before = (await svc.getReport(100)).totals;
    const a = await school('Rep A', true);
    const b = await school('Rep B');
    const c = await school('Rep C (idle)');
    const d = await school('Rep D (used only)');
    await ds.query(
      `INSERT INTO sms_stock_entries (bought_on, sms_count, cost_paisa, note) VALUES ('2026-11-01', 1000, 2000, 'rep-spec')`,
    );
    // A: ACTIVE 100 sms 5000 @2.5 = cost 250; PAID 200 sms 9000 @2.5 = cost 500.
    await order(a, { status: 'ACTIVE', sms: 100, price: 5000, cost: 2.5 });
    await order(a, { status: 'PAID', sms: 200, price: 9000, cost: 2.5 });
    // Never income: cancelled with a stray paid_at, pending, refunded.
    await order(a, { status: 'CANCELLED', sms: 999, price: 777, cost: 1 });
    await order(a, { status: 'PENDING_PAYMENT', sms: 999, price: 777, cost: 1, paid: false });
    await order(a, { status: 'REFUNDED', sms: 999, price: 777, cost: 1 });
    // B: EXPIRED 100 sms 5000, cost unknown counts as 0.
    await order(b, { status: 'EXPIRED', sms: 100, price: 5000, cost: null });
    await ledger(a, 'DEBIT', 30);
    await ledger(b, 'EXPIRE', 40);
    await ledger(d, 'DEBIT', 5);
    // A holds an expired lot (50, written off, not promised) and a live one (20, promised).
    await lot(a, 50, new Date(Date.now() - 86_400_000));
    await lot(a, 20, new Date(Date.now() + 20 * 86_400_000));
    // A's last 30 days: 1 failed, 3 accepted SMS; an email failure is not counted.
    for (const [status, medium] of [
      ['FAILED', 'SMS'],
      ['SENT', 'SMS'],
      ['DELIVERED', 'SMS'],
      ['READ', 'SMS'],
      ['FAILED', 'EMAIL'],
    ])
      await ds.query(
        `INSERT INTO communication_logs (tenant_id, medium, recipient_address, recipient_name, message_body, status)
         VALUES ($1,$2,'x','x','x',$3)`,
        [a, medium, status],
      );

    const report = await svc.getReport(100);
    const t = report.totals;
    expect(t.boughtSms - before.boughtSms).toBe(1000);
    expect(t.soldSms - before.soldSms).toBe(400);
    expect(t.revenuePaisa - before.revenuePaisa).toBe(19000);
    expect(t.costPaisa - before.costPaisa).toBe(750);
    expect(t.marginPaisa - before.marginPaisa).toBe(18250);
    expect(t.usedSms - before.usedSms).toBe(35);
    expect(t.expiredSms - before.expiredSms).toBe(40);
    expect(t.unsoldSms - before.unsoldSms).toBe(600);
    expect(t.promisedUnusedSms - before.promisedUnusedSms).toBe(20);

    const row = (id: string) => report.schools.find((s) => s.schoolId === id);
    expect(row(a)).toMatchObject({
      orders: 2,
      soldSms: 300,
      usedSms: 30,
      revenuePaisa: 14000,
      costPaisa: 750,
      marginPaisa: 13250,
      failedSms: 1,
      sentSms: 4,
      failureRateBp: 2500,
    });
    expect(row(b)).toMatchObject({
      soldSms: 100,
      expiredSms: 40,
      revenuePaisa: 5000,
      costPaisa: 0,
    });
    expect(row(d)).toMatchObject({ orders: 0, usedSms: 5, revenuePaisa: 0, failureRateBp: null });
    expect(row(c)).toBeUndefined();
    expect(report.packages.find((p) => p.catalogId === catalogId)?.orders).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('pages by keyset (margin desc, school id) without overlap, and the CSV defuses names', async () => {
    const x = await school('=cmd()');
    await order(x, { status: 'ACTIVE', sms: 100, price: 4242, cost: null });
    await order(await school('Rep Y'), { status: 'ACTIVE', sms: 100, price: 100, cost: null });
    const p1 = await svc.getReport(1);
    expect(p1.schools).toHaveLength(1);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await svc.getReport(1, p1.nextCursor!);
    expect(p2.schools[0].schoolId).not.toBe(p1.schools[0].schoolId);
    expect(p2.schools[0].marginPaisa).toBeLessThanOrEqual(p1.schools[0].marginPaisa);

    const csv = svc.toCsv(await svc.csvRows());
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.split('\r\n')[0]).toContain('School');
    expect(csv).toContain("'=cmd()");
    expect(csv).not.toMatch(/(^|,)=cmd\(\)/m);
  });

  it('a bad cursor is a fixed 400', async () => {
    await expect(svc.getReport(10, 'not-a-cursor')).rejects.toThrow('Invalid cursor.');
  });
});
