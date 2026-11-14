import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { removeCockpitOwners } from '@test/helpers/cockpit-token.helper';
import {
  API,
  MoneyApp,
  MoneySchool,
  bootMoneyApp,
  createMoneySchool,
  expectLedgerInvariant,
  insertPackage,
} from '@test/helpers/money-e2e.helper';
import { SmsCreditService } from './modules/communications/credits/sms-credit.service';

/**
 * [Epic 100 #3893] Money races end to end over HTTP: one winner per race, lots drawn in order,
 * and a refund that is refused once SMS were sent. Two schools (A, B) live for the whole file;
 * orders, lots, coupons and packages are made inside each `it` (the harness clears those tables
 * before every test). bKash and the step-up guard are stand-ins (see money-e2e.helper.ts).
 * HTTP cannot hold a request, so each race fires both calls with `Promise.all` and asserts the
 * outcome set, not the order; the row-level locks (`FOR UPDATE`) are what make it deterministic.
 */
describe('money races E2E (#3893)', () => {
  let m: MoneyApp;
  let ds: DataSource;
  let A: MoneySchool;
  let B: MoneySchool;

  const asSchool = (s: MoneySchool, r: supertest.Test) =>
    r.set('Authorization', `Bearer ${s.token}`).set('X-Tenant-ID', s.id);
  const buyPackage = (s: MoneySchool, packageId: string, key = randomUUID()) =>
    asSchool(s, m.http().post(`${API}/sms-bundles/orders`)).send({
      package_id: packageId,
      idempotency_key: key,
    });
  const seatOrder = (s: MoneySchool, body: Record<string, unknown> = {}) =>
    asSchool(s, m.http().post(`${API}/billing/orders`)).send({
      seats: 10,
      months: 1,
      idempotency_key: randomUUID(),
      ...body,
    });
  const owner = (path: string, body: object, key = randomUUID()) =>
    m
      .http()
      .post(`${API}/platform${path}`)
      .set('Authorization', `Bearer ${m.ownerToken}`)
      .set('Idempotency-Key', key)
      .send(body);
  const payOffline = (kind: 'orders' | 'sms-bundle-orders', id: string, reference?: string) =>
    owner(`/billing/${kind}/${id}/offline-payment`, {
      method: 'OFFLINE_CASH',
      reference: reference ?? `E2E${randomUUID().slice(0, 8)}`,
      idempotency_key: randomUUID(),
    });
  const callback = (paymentID: string) =>
    m.http().get(`${API}/billing/bkash/callback?paymentID=${paymentID}&status=success`);
  const lots = (tenantId: string) =>
    ds.query(
      `SELECT id, units_total, remaining, reserved_units, debited_units, expired_units, status
         FROM sms_credit_lots WHERE tenant_id = $1 ORDER BY expires_at`,
      [tenantId],
    );
  const newCoupon = async (percent: number, maxUses: number | null) => {
    const code = `E2E-R-${randomUUID().slice(0, 6).toUpperCase()}`;
    const [row] = await ds.query(
      `INSERT INTO coupons (code, discount_kind, percent, scope, max_uses, starts_at, ends_at)
       VALUES ($1, 'PERCENT', $2, 'ALL', $3, now() - interval '1 day', now() + interval '1 day')
       RETURNING id`,
      [code, percent, maxUses],
    );
    return { code, id: row.id as string };
  };
  /** A metered lot made by SQL so a test can choose its expiry and size. */
  const insertLot = async (tenantId: string, units: number, expiresInDays: number) => {
    await ds.query(
      `INSERT INTO sms_credit_balance (tenant_id, available, reserved, updated_at)
       VALUES ($1, $2, 0, now())
       ON CONFLICT (tenant_id) DO UPDATE SET available = sms_credit_balance.available + $2`,
      [tenantId, units],
    );
    const [row] = await ds.query(
      `INSERT INTO sms_credit_lots (tenant_id, source, units_total, remaining, expires_at, status)
       VALUES ($1, 'MANUAL', $2, $2, now() + make_interval(days => $3), 'ACTIVE') RETURNING id`,
      [tenantId, units, expiresInDays],
    );
    return row.id as string;
  };

  beforeAll(async () => {
    m = await bootMoneyApp();
    ds = m.ds;
    A = await createMoneySchool(m, 'a');
    B = await createMoneySchool(m, 'b');
  }, 120_000);

  afterAll(async () => {
    await removeCockpitOwners(ds);
    await m.app.close();
  });

  it('the last use of a coupon goes to one of two racing schools; the loser gets the one fixed refusal', async () => {
    const { code, id } = await newCoupon(10, 1);
    const [a, b] = await Promise.all([
      seatOrder(A, { coupon_code: code }),
      seatOrder(B, { coupon_code: code }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    const loser = a.status === 400 ? a : b;
    // Rule 23: the same sentence a wrong code gets, and never the submitted code.
    const wrong = await seatOrder(A, { coupon_code: 'E2E-NOPE-000000' }).expect(400);
    expect(loser.body.message).toBe(wrong.body.message);
    expect(JSON.stringify(loser.body)).not.toContain(code);
    const [{ uses }] = await ds.query('SELECT uses_count AS uses FROM coupons WHERE id = $1', [id]);
    expect(uses).toBe(1);
    const [{ n }] = await ds.query(
      'SELECT count(*)::int AS n FROM coupon_redemptions WHERE coupon_id = $1',
      [id],
    );
    expect(n).toBe(1);
    await expectLedgerInvariant(ds, A.id);
  });

  it('a bKash callback delivered twice at once pays a package order once: one payment, one receipt, one lot', async () => {
    const pkg = await insertPackage(ds, 100);
    const order = (await buyPackage(A, pkg).expect(201)).body;
    const pay = await asSchool(
      A,
      m.http().post(`${API}/sms-bundles/orders/${order.id}/pay/bkash`),
    ).expect(200);
    const paymentID = pay.body.bkash_url.split('/').pop() as string;

    const [first, second] = await Promise.all([callback(paymentID), callback(paymentID)]);
    for (const r of [first, second]) expect(r.status).toBe(302);

    const [{ payments }] = await ds.query(
      'SELECT count(*)::int AS payments FROM platform_payments WHERE bundle_order_id = $1',
      [order.id],
    );
    expect(payments).toBe(1);
    const [row] = await ds.query(
      'SELECT status, receipt_number FROM sms_bundle_orders WHERE id = $1',
      [order.id],
    );
    expect(row.status).toBe('ACTIVE');
    expect(row.receipt_number).toMatch(/^SMR-\d{4}-\d{6}$/);
    expect(await lots(A.id)).toHaveLength(1);
    await expectLedgerInvariant(ds, A.id);
  });

  it('a package order paid twice at once (bKash callback and an owner, then another owner) makes one lot', async () => {
    const pkg = await insertPackage(ds, 100);
    const order = (await buyPackage(B, pkg).expect(201)).body;
    const pay = await asSchool(
      B,
      m.http().post(`${API}/sms-bundles/orders/${order.id}/pay/bkash`),
    ).expect(200);
    const paymentID = pay.body.bkash_url.split('/').pop() as string;
    // The callback and the owner's offline payment race. An offline payment against a live bKash
    // payment may be refused (409) or find the order already paid; it must never pay it twice.
    const [cb, offline] = await Promise.all([
      callback(paymentID),
      payOffline('sms-bundle-orders', order.id),
    ]);
    expect(cb.status).toBe(302);
    expect([200, 409]).toContain(offline.status);
    const again = await payOffline('sms-bundle-orders', order.id).expect(200);
    expect(again.body.applied).toBe(false);
    expect(await lots(B.id)).toHaveLength(1);
    const [{ payments }] = await ds.query(
      "SELECT count(*)::int AS payments FROM platform_payments WHERE bundle_order_id = $1 AND (raw->>'orphan') IS DISTINCT FROM 'true'",
      [order.id],
    );
    expect(payments).toBe(1);
    await expectLedgerInvariant(ds, B.id);
  });

  it('two owners recording an offline payment at once pay a package order once', async () => {
    const pkg = await insertPackage(ds, 100);
    const order = (await buyPackage(A, pkg).expect(201)).body;
    const [x, y] = await Promise.all([
      payOffline('sms-bundle-orders', order.id),
      payOffline('sms-bundle-orders', order.id),
    ]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect([x.body.applied, y.body.applied].sort()).toEqual([false, true]);
    expect(await lots(A.id)).toHaveLength(1);
    const [{ payments }] = await ds.query(
      'SELECT count(*)::int AS payments FROM platform_payments WHERE bundle_order_id = $1',
      [order.id],
    );
    expect(payments).toBe(1);
    await expectLedgerInvariant(ds, A.id);
  });

  it('a reserve draws the earliest-expiry lot first and records the draw', async () => {
    // Made later but expiring earlier: the draw must follow expiry, not creation.
    const late = await insertLot(A.id, 5, 20);
    const early = await insertLot(A.id, 5, 10);
    const credits = m.app.get(SmsCreditService);
    const key = `batch:${randomUUID()}`;
    await expect(credits.reserve(A.id, 3, key, { type: 'batch', id: null })).resolves.toEqual({
      ok: true,
    });
    const draws = await ds.query(
      'SELECT lot_id, units FROM sms_credit_lot_draws WHERE tenant_id = $1 AND reserve_key = $2',
      [A.id, key],
    );
    expect(draws).toEqual([{ lot_id: early, units: 3 }]);
    const rows = await lots(A.id);
    expect(rows.find((l: { id: string }) => l.id === early)).toMatchObject({
      remaining: 2,
      reserved_units: 3,
    });
    expect(rows.find((l: { id: string }) => l.id === late)).toMatchObject({
      remaining: 5,
      reserved_units: 0,
    });
    await credits.settle(A.id, key, 'RELEASE');
    await expectLedgerInvariant(ds, A.id);
  });

  it('the expiry job never touches reserved units; they settle after the lot is past its date', async () => {
    const lot = await insertLot(B.id, 10, 5);
    const credits = m.app.get(SmsCreditService);
    const key = `batch:${randomUUID()}`;
    await credits.reserve(B.id, 3, key, { type: 'batch', id: null });
    // The lot's date passes while 3 units are reserved.
    await ds.query(
      `UPDATE sms_credit_lots SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [lot],
    );
    await credits.expireDue(new Date());
    expect((await lots(B.id))[0]).toMatchObject({
      remaining: 0,
      reserved_units: 3,
      expired_units: 7,
    });
    await expectLedgerInvariant(ds, B.id);
    // The send finishes: the reserved part is debited, not expired.
    await credits.settle(B.id, key, 'DEBIT');
    expect((await lots(B.id))[0]).toMatchObject({
      remaining: 0,
      reserved_units: 0,
      debited_units: 3,
      expired_units: 7,
    });
    await expectLedgerInvariant(ds, B.id);
  });

  it('refund of a package order is refused after one SMS was sent, and the lot stays intact', async () => {
    const pkg = await insertPackage(ds, 100);
    const order = (await buyPackage(A, pkg).expect(201)).body;
    await payOffline('sms-bundle-orders', order.id).expect(200);
    const credits = m.app.get(SmsCreditService);
    const key = `batch:${randomUUID()}`;
    await credits.reserve(A.id, 1, key, { type: 'batch', id: null });
    await credits.settle(A.id, key, 'DEBIT');

    const refused = await owner(`/billing/sms-bundle-orders/${order.id}/refund`, {
      reason: 'Customer asked for money back',
    }).expect(409);
    expect(refused.body.details).toEqual({ code: 'BUNDLE_ALREADY_USED' });
    expect((await lots(A.id))[0]).toMatchObject({
      remaining: 99,
      debited_units: 1,
      status: 'ACTIVE',
    });
    const [{ status }] = await ds.query('SELECT status FROM sms_bundle_orders WHERE id = $1', [
      order.id,
    ]);
    expect(status).toBe('ACTIVE');
    await expectLedgerInvariant(ds, A.id);
  });

  it('refund of a seat order drops the seats and does not give the coupon use back', async () => {
    const { code, id } = await newCoupon(50, 5);
    const order = (await seatOrder(B, { coupon_code: code }).expect(201)).body;
    await payOffline('orders', order.id).expect(200);
    const seats = async () =>
      (await asSchool(B, m.http().get(`${API}/billing/summary`)).expect(200)).body.seats_bought;
    expect(await seats()).toBe(10);
    await owner(`/billing/orders/${order.id}/refund`, {
      reason: 'Customer changed their mind',
    }).expect(200);
    expect(await seats()).toBe(0);
    const [{ uses }] = await ds.query('SELECT uses_count AS uses FROM coupons WHERE id = $1', [id]);
    expect(uses).toBe(1);
    await expectLedgerInvariant(ds, B.id);
  });
});
