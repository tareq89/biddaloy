import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../schools/entities/school.entity';
import { RevenueService } from './revenue.service';

describe('RevenueService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let svc: RevenueService;
  let a: string;
  let b: string;
  let c: string;
  let d: string;
  let e: string;
  let catalogId: string;

  const sfx = () => randomUUID().slice(0, 8);
  const school = async (name: string) => {
    const s = sfx();
    const row = await ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name, slug: `rv-${s}` }));
    return row.id;
  };
  // seats 1, months as given; amount = months * unit - discount (the table CHECK).
  const seat = (o: {
    school: string;
    status: string;
    unit: number;
    months: number;
    discount?: number;
    paidAt: string;
    periodEnd: string;
    refundedAt?: string;
  }) =>
    ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa,
         discount_paisa, period_start, period_end, status, idempotency_key, paid_at, refunded_at)
       VALUES ($1, 1, $2, $3, $4, $5, '2026-01-01', $6, $7, $8, $9, $10)`,
      [
        o.school,
        o.months,
        o.unit,
        o.months * o.unit - (o.discount ?? 0),
        o.discount ?? 0,
        o.periodEnd,
        o.status,
        randomUUID(),
        o.paidAt,
        o.refundedAt ?? null,
      ],
    );
  const pkg = (school: string, price: number, status: string, paidAt: string) =>
    ds.query(
      `INSERT INTO sms_bundle_orders (school_id, catalog_id, name_snapshot, sms_count,
         validity_days, price_paisa, status, idempotency_key, paid_at)
       VALUES ($1, $2, 'Pack', 100, 30, $3, $4, $5, $6)`,
      [school, catalogId, price, status, randomUUID(), paidAt],
    );

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    svc = new RevenueService(ds);
  });

  // The global setup resets every table before each test, so the data is seeded per test.
  beforeEach(async () => {
    a = await school('School A');
    b = await school('School B');
    c = await school('School C');
    d = await school('=HYPERLINK("http://x")'); // a formula-looking name
    e = await school('School E');
    const [cat] = (await ds.query(
      `INSERT INTO sms_bundle_catalog (name, sms_count, validity_days, price_paisa, active, sort_order)
       VALUES ('Pack', 100, 30, 5000, true, 1) RETURNING id`,
    )) as { id: string }[];
    catalogId = cat.id;

    // March (Dhaka): A paid 100000, B paid 60000 (refunded in April), D bought a package 5000.
    await seat({
      school: a,
      status: 'PAID',
      unit: 50000,
      months: 2,
      paidAt: '2026-03-10T05:00:00Z',
      periodEnd: '2026-03-31',
    });
    await seat({
      school: b,
      status: 'REFUNDED',
      unit: 30000,
      months: 2,
      paidAt: '2026-03-15T05:00:00Z',
      periodEnd: '2026-05-31',
      refundedAt: '2026-04-05T05:00:00Z',
    });
    // A GRANT (unit price 0) and a 100 percent coupon order: both count 0.
    await seat({
      school: c,
      status: 'PAID',
      unit: 0,
      months: 1,
      paidAt: '2026-03-12T05:00:00Z',
      periodEnd: '2099-01-01',
    });
    await seat({
      school: c,
      status: 'PAID',
      unit: 20000,
      months: 1,
      discount: 20000,
      paidAt: '2026-03-12T06:00:00Z',
      periodEnd: '2026-05-31',
    });
    await pkg(d, 5000, 'ACTIVE', '2026-03-20T05:00:00Z');
    // April: A renews and buys a package.
    await seat({
      school: a,
      status: 'PAID',
      unit: 40000,
      months: 1,
      paidAt: '2026-04-10T05:00:00Z',
      periodEnd: '2026-04-30',
    });
    await pkg(a, 7000, 'PAID', '2026-04-02T05:00:00Z');
    // E has renewed far into the future.
    await seat({
      school: e,
      status: 'PAID',
      unit: 10000,
      months: 1,
      paidAt: '2026-02-01T05:00:00Z',
      periodEnd: '2099-01-01',
    });
  });

  afterAll(async () => {
    await module?.close();
  });

  it('March: seat and package income apart, GRANT and 100% coupon count 0, 3 paying schools', async () => {
    const r = await svc.report('2026-03');
    expect(r.seat_income_paisa).toBe(160000); // 100000 (A) + 60000 (B, refunded later)
    expect(r.package_income_paisa).toBe(5000);
    expect(r.refunds_paisa).toBe(0); // the refund happened in April
    expect(r.net_paisa).toBe(165000);
    expect(r.paying_schools).toBe(3); // A, B, D; C paid nothing
  });

  it('April: the refund is netted in the month it happened, on its own line', async () => {
    const r = await svc.report('2026-04');
    expect(r.seat_income_paisa).toBe(40000);
    expect(r.package_income_paisa).toBe(7000);
    expect(r.refunds_paisa).toBe(60000);
    expect(r.net_paisa).toBe(-13000);
    expect(r.paying_schools).toBe(1);
  });

  it('not-renewed lists ended schools newest first and skips renewed ones and refunded orders', async () => {
    const r = await svc.report('2026-03');
    const ids = r.not_renewed.items.map((i) => i.school_id);
    expect(ids).toEqual([c, a]); // C ended 2026-05-30, A 2026-04-29; E renewed; B only has a refunded order
    expect(r.not_renewed.items[0].paid_until).toBe('2026-05-30');
    expect(r.not_renewed.items[0].days_since_ended).toBeGreaterThan(0);
    expect(r.not_renewed.next_cursor).toBeNull();
  });

  it('keyset cursor pages the not-renewed list with no repeats', async () => {
    const p1 = await svc.report('2026-03', undefined, 1);
    expect(p1.not_renewed.items.map((i) => i.school_id)).toEqual([c]);
    expect(p1.not_renewed.next_cursor).toBeTruthy();
    const p2 = await svc.report('2026-03', p1.not_renewed.next_cursor!, 1);
    expect(p2.not_renewed.items.map((i) => i.school_id)).toEqual([a]);
    expect(p2.not_renewed.next_cursor).toBeNull();
  });

  it('a forged cursor is a fixed 400 and echoes nothing', async () => {
    const forged = Buffer.from(JSON.stringify({ d: "x'; DROP", id: 'nope' })).toString('base64url');
    await expect(svc.report('2026-03', forged)).rejects.toThrow(BadRequestException);
    await expect(svc.report('2026-03', '%%%')).rejects.toThrow('Invalid cursor');
  });

  it('csv neutralises a formula cell and carries per-school totals', async () => {
    const { body } = await svc.csv('2026-03');
    expect(body).toContain(`"'=HYPERLINK(""http://x"")"`); // leading apostrophe: text, not a formula
    expect(body).not.toContain(`"=HYPERLINK`);
    expect(body).toContain('"School A","100000","0","0","100000"');
  });
});
