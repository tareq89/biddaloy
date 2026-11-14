import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { makeMeteredCreditService } from '@test/helpers/sms-credit-ledger.helper';
import { SmsCreditService } from './sms-credit.service';

const DAY = 24 * 60 * 60 * 1000;

/**
 * [#3852] Lot-aware credit against the real schema. After EVERY operation `expectInvariant`
 * checks that the balance row equals the sum of the lots, that every lot's counters add up,
 * that status matches counters, and that every draw sits on a lot of its own tenant.
 */
describe('SmsCreditService lots (integration)', () => {
  let ds: DataSource;
  let svc: SmsCreditService;
  let a: string;
  let b: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    svc = makeMeteredCreditService(ds);
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const makeSchool = async (): Promise<string> => {
    const [{ id }] = await ds.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), 'SMS Lots', 'sms-lots-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    return id;
  };

  beforeEach(async () => {
    a = await makeSchool();
    b = await makeSchool();
  });

  afterEach(async () => {
    await ds.query(`DELETE FROM "schools" WHERE id IN ($1, $2)`, [a, b]);
  });

  const lotsOf = (t: string) =>
    ds.query(`SELECT * FROM "sms_credit_lots" WHERE tenant_id = $1 ORDER BY created_at, id`, [t]);

  async function expectInvariant(t: string): Promise<void> {
    const lots = await lotsOf(t);
    const [bal] = await ds.query(
      `SELECT available, reserved FROM "sms_credit_balance" WHERE tenant_id = $1`,
      [t],
    );
    const sum = (k: string) => lots.reduce((s: number, l: any) => s + l[k], 0);
    expect({ available: bal?.available ?? 0, reserved: bal?.reserved ?? 0 }).toEqual({
      available: sum('remaining'),
      reserved: sum('reserved_units'),
    });
    const [{ open }] = await ds.query(
      `SELECT COALESCE(sum(open_units), 0)::int AS open FROM "sms_credit_lot_draws" WHERE tenant_id = $1`,
      [t],
    );
    expect(open).toBe(sum('reserved_units'));
    for (const l of lots) {
      expect(l.remaining + l.reserved_units + l.debited_units + l.expired_units).toBe(
        l.units_total,
      );
      if (l.status === 'ACTIVE') {
        expect(l.remaining + l.reserved_units).toBeGreaterThan(0);
      } else {
        expect(l.remaining + l.reserved_units).toBe(0);
      }
    }
    const [{ stray }] = await ds.query(
      `SELECT count(*)::int AS stray FROM "sms_credit_lot_draws" d
         JOIN "sms_credit_lots" l ON l.id = d.lot_id WHERE d.tenant_id = $1 AND l.tenant_id <> d.tenant_id`,
      [t],
    );
    expect(stray).toBe(0);
  }

  const lotRow = (id: string) =>
    ds.query(`SELECT * FROM "sms_credit_lots" WHERE id = $1`, [id]).then((r: any[]) => r[0]);

  it('reserve spans two lots (earliest expiry first) and records two draws', async () => {
    await svc.grant(a, 5, {
      idempotencyKey: `g1-${a}`,
      expiresAt: new Date(Date.now() + 30 * DAY),
    });
    await svc.grant(a, 10, { idempotencyKey: `g2-${a}` });
    await expectInvariant(a);
    expect(await svc.reserve(a, 8, `r-${a}`)).toEqual({ ok: true });
    await expectInvariant(a);
    const draws = await ds.query(
      `SELECT units FROM "sms_credit_lot_draws" WHERE tenant_id = $1 AND reserve_key = $2 ORDER BY units`,
      [a, `r-${a}`],
    );
    expect(draws.map((d: any) => d.units)).toEqual([3, 5]);
    const [soon] = (await lotsOf(a)).filter((l: any) => l.expires_at);
    expect(soon).toMatchObject({ remaining: 0, reserved_units: 5, status: 'ACTIVE' });
  });

  it('an expired lot is not used, and the short answer counts only usable units', async () => {
    await ds.query(
      `INSERT INTO "sms_credit_lots" (tenant_id, source, units_total, remaining, expires_at)
       VALUES ($1, 'MANUAL', 10, 10, now() - interval '1 day')`,
      [a],
    );
    await ds.query(
      `INSERT INTO "sms_credit_balance" (tenant_id, available, reserved) VALUES ($1, 10, 0)`,
      [a],
    );
    await svc.grant(a, 3, { idempotencyKey: `g-${a}` });
    expect(await svc.reserve(a, 4, `r-${a}`)).toEqual({ ok: false, available: 3 });
    await expectInvariant(a);
    expect(await svc.reserve(a, 3, `r2-${a}`)).toEqual({ ok: true });
    await expectInvariant(a);
  });

  it('release returns units to the originating lot and marks nothing used up', async () => {
    await svc.grant(a, 5, {
      idempotencyKey: `g1-${a}`,
      expiresAt: new Date(Date.now() + 30 * DAY),
    });
    await svc.grant(a, 5, { idempotencyKey: `g2-${a}` });
    await svc.reserve(a, 5, `r-${a}`);
    await svc.settle(a, `r-${a}`, 'RELEASE');
    await expectInvariant(a);
    const [soon] = (await lotsOf(a)).filter((l: any) => l.expires_at);
    expect(soon).toMatchObject({ remaining: 5, reserved_units: 0, status: 'ACTIVE' });
    expect(await svc.getBalance(a)).toEqual({ available: 10, reserved: 0 });
  });

  it('debit uses a lot up (USED_UP); a later refund returns to it and reactivates it', async () => {
    await svc.grant(a, 4, { idempotencyKey: `g-${a}` });
    await svc.reserve(a, 4, `r-${a}`);
    await svc.settle(a, `r-${a}`, 'DEBIT');
    await expectInvariant(a);
    expect((await lotsOf(a))[0]).toMatchObject({ status: 'USED_UP', debited_units: 4 });
    await ds.transaction((m) => svc.refundForLog(m, a, '55555555-5555-5555-5555-555555555555', 3));
    await ds.transaction((m) => svc.refundForLog(m, a, '55555555-5555-5555-5555-555555555555', 3));
    await expectInvariant(a);
    const lots = await lotsOf(a);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ remaining: 3, debited_units: 1, status: 'ACTIVE' });
  });

  it('a refund with no lot holding debited units creates a MANUAL no-expiry lot', async () => {
    await ds.transaction((m) => svc.refundForLog(m, a, '66666666-6666-6666-6666-666666666666', 2));
    await expectInvariant(a);
    expect((await lotsOf(a))[0]).toMatchObject({
      source: 'MANUAL',
      expires_at: null,
      remaining: 2,
    });
  });

  it('settlePart splits across lots', async () => {
    await svc.grant(a, 3, {
      idempotencyKey: `g1-${a}`,
      expiresAt: new Date(Date.now() + 30 * DAY),
    });
    await svc.grant(a, 7, { idempotencyKey: `g2-${a}` });
    await svc.reserve(a, 6, `batch-${a}`, { type: 'batch', id: a });
    await svc.settlePart(a, `batch-${a}`, `l1-${a}`, 4, 'DEBIT');
    await expectInvariant(a);
    await svc.settlePart(a, `batch-${a}`, `l2-${a}`, 2, 'RELEASE');
    await expectInvariant(a);
    expect(await svc.getBalance(a)).toEqual({ available: 6, reserved: 0 });
    const [soon, never] = [...(await lotsOf(a))].sort((x: any, y: any) => (x.expires_at ? -1 : 1));
    expect(soon).toMatchObject({ debited_units: 3, status: 'USED_UP' });
    expect(never).toMatchObject({ debited_units: 1, remaining: 6 });
  });

  it('expireDue expires only remaining, keeps reserved units, and is a no-op the second time', async () => {
    await svc.grant(a, 10, { idempotencyKey: `g-${a}`, expiresAt: new Date(Date.now() + DAY) });
    await svc.reserve(a, 4, `r-${a}`);
    const later = new Date(Date.now() + 2 * DAY);
    expect(await svc.expireDue(later)).toMatchObject({ lots: expect.any(Number) });
    await expectInvariant(a);
    // Reserved units keep the lot ACTIVE until they settle.
    expect((await lotsOf(a))[0]).toMatchObject({
      remaining: 0,
      reserved_units: 4,
      expired_units: 6,
      status: 'ACTIVE',
    });
    const again = await svc.expireDue(later);
    expect(again.units).toBe(0);
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM "sms_credit_ledger" WHERE tenant_id = $1 AND kind = 'EXPIRE'`,
      [a],
    );
    expect(n).toBe(1);
    await svc.settle(a, `r-${a}`, 'DEBIT');
    await expectInvariant(a);
    expect((await lotsOf(a))[0]).toMatchObject({ status: 'USED_UP', debited_units: 4 });
  });

  it('purchase is idempotent and creates one BUNDLE lot', async () => {
    const [{ id: catalogId }] = await ds.query(
      `INSERT INTO "sms_bundle_catalog" (name, sms_count, validity_days, price_paisa)
       VALUES ('Lots test ' || substr(gen_random_uuid()::text, 1, 8), 100, 30, 1000) RETURNING id`,
    );
    const [{ id: orderId }] = await ds.query(
      `INSERT INTO "sms_bundle_orders" (school_id, catalog_id, name_snapshot, sms_count, validity_days, price_paisa, status, idempotency_key)
       VALUES ($1, $2, 'x', 100, 30, 1000, 'PAID', $3) RETURNING id`,
      [a, catalogId, `o-${a}`],
    );
    const input = {
      bundleOrderId: orderId,
      units: 100,
      expiresAt: new Date(Date.now() + 30 * DAY),
      idempotencyKey: `purchase:${orderId}`,
    };
    try {
      expect(await svc.purchase(a, input)).toEqual({ available: 100, reserved: 0 });
      expect(await svc.purchase(a, input)).toEqual({ available: 100, reserved: 0 });
      await expectInvariant(a);
      const lots = await lotsOf(a);
      expect(lots).toHaveLength(1);
      expect(lots[0]).toMatchObject({ source: 'BUNDLE', bundle_order_id: orderId });
      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM "sms_credit_ledger" WHERE tenant_id = $1 AND kind = 'PURCHASE'`,
        [a],
      );
      expect(n).toBe(1);
    } finally {
      // Orders and lots block the school delete (RESTRICT), so clear them here.
      await ds.query(`DELETE FROM "sms_credit_lots" WHERE tenant_id = $1`, [a]);
      await ds.query(`DELETE FROM "sms_bundle_orders" WHERE id = $1`, [orderId]);
      await ds.query(`DELETE FROM "sms_bundle_catalog" WHERE id = $1`, [catalogId]);
    }
  });

  it('two purchases with one key in one shared transaction: the second is a no-op, no unique violation', async () => {
    const [{ id: catalogId }] = await ds.query(
      `INSERT INTO "sms_bundle_catalog" (name, sms_count, validity_days, price_paisa)
       VALUES ('Lots race ' || substr(gen_random_uuid()::text, 1, 8), 100, 30, 1000) RETURNING id`,
    );
    const [{ id: orderId }] = await ds.query(
      `INSERT INTO "sms_bundle_orders" (school_id, catalog_id, name_snapshot, sms_count, validity_days, price_paisa, status, idempotency_key)
       VALUES ($1, $2, 'x', 100, 30, 1000, 'PAID', $3) RETURNING id`,
      [a, catalogId, `o2-${a}`],
    );
    const input = {
      bundleOrderId: orderId,
      units: 100,
      expiresAt: new Date(Date.now() + 30 * DAY),
      idempotencyKey: `purchase:${orderId}`,
    };
    try {
      // Both calls share one connection, so they interleave inside one transaction.
      await ds.transaction((manager) =>
        Promise.all([svc.purchase(a, input, { manager }), svc.purchase(a, input, { manager })]),
      );
      await expectInvariant(a);
      expect(await lotsOf(a)).toHaveLength(1);
      expect(await svc.getBalance(a)).toEqual({ available: 100, reserved: 0 });
    } finally {
      await ds.query(`DELETE FROM "sms_credit_lots" WHERE tenant_id = $1`, [a]);
      await ds.query(`DELETE FROM "sms_bundle_orders" WHERE id = $1`, [orderId]);
      await ds.query(`DELETE FROM "sms_bundle_catalog" WHERE id = $1`, [catalogId]);
    }
  });

  it('settling the last reserved units of a lot past its expiry makes it EXPIRED', async () => {
    await ds.query(
      `INSERT INTO "sms_credit_lots" (tenant_id, source, units_total, remaining, reserved_units, expires_at)
       VALUES ($1, 'MANUAL', 2, 0, 2, now() - interval '1 hour')`,
      [a],
    );
    const [lot] = await lotsOf(a);
    await ds.query(
      `INSERT INTO "sms_credit_lot_draws" (tenant_id, lot_id, reserve_key, units, open_units) VALUES ($1, $2, $3, 2, 2)`,
      [a, lot.id, `k-${a}`],
    );
    await ds.query(
      `INSERT INTO "sms_credit_balance" (tenant_id, available, reserved) VALUES ($1, 0, 2)`,
      [a],
    );
    await ds.query(
      `INSERT INTO "sms_credit_ledger" (tenant_id, kind, units, reference_type, idempotency_key) VALUES ($1, 'RESERVE', 2, 'manual', $2)`,
      [a, `k-${a}`],
    );
    await svc.settle(a, `k-${a}`, 'DEBIT');
    await expectInvariant(a);
    expect((await lotsOf(a))[0]).toMatchObject({ status: 'EXPIRED', debited_units: 2 });
  });

  it('a legacy reservation settles against its legacy: draw', async () => {
    // The #3851 backfill shape: one LEGACY lot with units reserved and a `legacy:<tenant>` draw.
    await ds.query(
      `INSERT INTO "sms_credit_lots" (id, tenant_id, source, units_total, remaining, reserved_units)
       VALUES (gen_random_uuid(), $1, 'LEGACY', 10, 6, 4)`,
      [a],
    );
    const [lot] = await lotsOf(a);
    await ds.query(
      `INSERT INTO "sms_credit_lot_draws" (tenant_id, lot_id, reserve_key, units, open_units) VALUES ($1, $2, $3, 4, 4)`,
      [a, lot.id, `legacy:${a}`],
    );
    await ds.query(
      `INSERT INTO "sms_credit_balance" (tenant_id, available, reserved) VALUES ($1, 6, 4)`,
      [a],
    );
    await ds.query(
      `INSERT INTO "sms_credit_ledger" (tenant_id, kind, units, reference_type, idempotency_key) VALUES ($1, 'RESERVE', 4, 'manual', $2)`,
      [a, `old-${a}`],
    );
    await expectInvariant(a);
    await svc.settle(a, `old-${a}`, 'DEBIT');
    await expectInvariant(a);
    expect(await svc.getBalance(a)).toEqual({ available: 6, reserved: 0 });
    // Nothing left to settle on the key: the existing 400 sentence.
    await expect(svc.settlePart(a, `old-${a}`, `x-${a}`, 1, 'DEBIT')).rejects.toThrow(
      'Settling these units would exceed the remaining reserved SMS credit balance.',
    );
  });

  it('adjust negative takes from remaining earliest-expiry-first; below the usable sum is the 400', async () => {
    await svc.grant(a, 3, {
      idempotencyKey: `g1-${a}`,
      expiresAt: new Date(Date.now() + 30 * DAY),
    });
    await svc.grant(a, 5, { idempotencyKey: `g2-${a}` });
    await svc.adjust(a, -4, { idempotencyKey: `adj-${a}` });
    await expectInvariant(a);
    const [soon] = (await lotsOf(a)).filter((l: any) => l.expires_at);
    expect(soon).toMatchObject({ remaining: 0, debited_units: 3, status: 'USED_UP' });
    await expect(svc.adjust(a, -5, { idempotencyKey: `adj2-${a}` })).rejects.toThrow(
      "Adjustment would drive this school's SMS credit balance below zero.",
    );
    await expectInvariant(a);
    expect(await svc.getBalance(a)).toEqual({ available: 4, reserved: 0 });
  });

  it('rebuildBalanceFromLots repairs a drifted balance row and writes no ledger row', async () => {
    await svc.grant(a, 5, { idempotencyKey: `g-${a}` });
    await ds.query(`UPDATE "sms_credit_balance" SET available = 99 WHERE tenant_id = $1`, [a]);
    const res = await svc.rebuildBalanceFromLots(a, 'test');
    expect(res.before.available).toBe(99);
    expect(res.after).toEqual({ available: 5, reserved: 0 });
    await expectInvariant(a);
    expect((await svc.listLedger(a, 1, 50)).total).toBe(1);
  });

  it('two reserves racing for the last units give exactly one success', async () => {
    await svc.grant(a, 5, { idempotencyKey: `g-${a}` });
    let open!: () => void;
    const latch = new Promise<void>((r) => (open = r));
    const racers = [1, 2].map(async (i) => {
      await latch;
      return svc.reserve(a, 5, `race-${a}-${i}`);
    });
    open();
    const results = await Promise.all(racers);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await svc.getBalance(a)).toEqual({ available: 0, reserved: 5 });
    await expectInvariant(a);
  });

  it("school A's reserve never touches school B's lots", async () => {
    await svc.grant(a, 5, { idempotencyKey: `ga-${a}` });
    await svc.grant(b, 50, { idempotencyKey: `gb-${b}` });
    expect(await svc.reserve(a, 6, `r-${a}`)).toEqual({ ok: false, available: 5 });
    expect(await svc.reserve(a, 5, `r2-${a}`)).toEqual({ ok: true });
    await expectInvariant(a);
    await expectInvariant(b);
    expect(await svc.getBalance(b)).toEqual({ available: 50, reserved: 0 });
    expect((await lotsOf(b))[0]).toMatchObject({ remaining: 50, reserved_units: 0 });
    expect(await lotRow((await lotsOf(b))[0].id)).toBeTruthy();
  });
});
