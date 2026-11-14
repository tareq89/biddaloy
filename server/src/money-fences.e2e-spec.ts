import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { COUPON_FAIL_LIMIT } from '@biddaloy/shared';
import { getOptionsToken, getStorageToken } from '@nestjs/throttler';
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
import { FailOpenThrottlerStorage } from './common/rate-limit/fail-open-throttler-storage';
import { CouponAttemptLimiter } from './modules/coupons/coupon-attempt.limiter';
import { SmsCreditService } from './modules/communications/credits/sms-credit.service';

/**
 * [Epic 100 #3893] The fences around money, end to end over HTTP: an oversold stock stops a buy
 * but never a send, a coupon never reaches a package order, a school never reaches another
 * school's package orders, Redis down stops the money writes (503, Rule 15) and not an SMS send,
 * too many wrong coupon codes wait, and no error body echoes what was sent (Rule 23).
 *
 * "Redis down" is a switch on two stand-ins that sit where Redis sits in production: the
 * rate-limit store (global guard; skipped under NODE_ENV=test unless the switch is on) and the
 * coupon limiter's counter store. Money tables are cleared before every `it`; schools persist.
 */
const redis = { down: false };
const counters = new Map<string, number>();
// An in-memory counter standing in for ioredis: same four calls the limiter makes.
const couponRedis = {
  get: async (k: string) => {
    if (redis.down) throw new Error('ECONNREFUSED');
    return counters.has(k) ? String(counters.get(k)) : null;
  },
  incr: async (k: string) => {
    if (redis.down) throw new Error('ECONNREFUSED');
    counters.set(k, (counters.get(k) ?? 0) + 1);
    return counters.get(k)!;
  },
  pexpire: async () => 1,
  del: async (...keys: string[]) => keys.filter((k) => counters.delete(k)).length,
};

describe('money fences E2E (#3893)', () => {
  let m: MoneyApp;
  let ds: DataSource;
  let A: MoneySchool;
  let B: MoneySchool;

  const asSchool = (s: MoneySchool, r: supertest.Test) =>
    r.set('Authorization', `Bearer ${s.token}`).set('X-Tenant-ID', s.id);
  const buyPackage = (s: MoneySchool, body: Record<string, unknown>) =>
    asSchool(s, m.http().post(`${API}/sms-bundles/orders`)).send({
      idempotency_key: randomUUID(),
      ...body,
    });
  const seatOrder = (s: MoneySchool, body: Record<string, unknown> = {}) =>
    asSchool(s, m.http().post(`${API}/billing/orders`)).send({
      seats: 10,
      months: 1,
      idempotency_key: randomUUID(),
      ...body,
    });
  const owner = (path: string, body: object) =>
    m
      .http()
      .post(`${API}/platform${path}`)
      .set('Authorization', `Bearer ${m.ownerToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const payOffline = (id: string) =>
    owner(`/billing/sms-bundle-orders/${id}/offline-payment`, {
      method: 'OFFLINE_CASH',
      reference: `E2E${randomUUID().slice(0, 8)}`,
      idempotency_key: randomUUID(),
    });
  const send = async (s: MoneySchool) => {
    const credits = m.app.get(SmsCreditService);
    const key = `batch:${randomUUID()}`;
    const res = await credits.reserve(s.id, 1, key, { type: 'batch', id: null });
    if (res.ok) await credits.settle(s.id, key, 'RELEASE');
    return res;
  };
  const activePackageOrder = async (s: MoneySchool, smsCount = 100) => {
    const pkg = await insertPackage(ds, smsCount);
    const order = (await buyPackage(s, { package_id: pkg }).expect(201)).body;
    await payOffline(order.id).expect(200);
    return { pkg, order };
  };
  const newCoupon = async (percent: number) => {
    const code = `E2E-F-${randomUUID().slice(0, 6).toUpperCase()}`;
    await ds.query(
      `INSERT INTO coupons (code, discount_kind, percent, scope, max_uses, starts_at, ends_at)
       VALUES ($1, 'PERCENT', $2, 'ALL', 5, now() - interval '1 day', now() + interval '1 day')`,
      [code, percent],
    );
    return code;
  };

  // The limiter's 15-minute TTL is pinned by coupon-attempt.limiter.spec.ts; here only the count.
  beforeEach(() => counters.clear());

  beforeAll(async () => {
    m = await bootMoneyApp((b) =>
      b
        .overrideProvider(CouponAttemptLimiter)
        .useValue(new CouponAttemptLimiter(couponRedis))
        // The same store the app wires, but unreachable on demand; `skipIf` is off only while
        // the switch is on, so every other test runs unthrottled as before.
        .overrideProvider(getStorageToken())
        .useValue(
          new FailOpenThrottlerStorage({
            increment: () => Promise.reject(new Error('ECONNREFUSED')),
          }),
        )
        .overrideProvider(getOptionsToken())
        .useValue({
          throttlers: [{ name: 'default', limit: 1000, ttl: 60_000 }],
          skipIf: () => !redis.down,
        }),
    );
    ds = m.ds;
    A = await createMoneySchool(m, 'a');
    B = await createMoneySchool(m, 'b');
  }, 120_000);

  afterAll(async () => {
    redis.down = false;
    await removeCockpitOwners(ds);
    await m.app.close();
  });

  it('oversold stops a new package buy with the fixed sentence, but an SMS send for a school with units still works', async () => {
    await activePackageOrder(A, 100);
    const pkg = await insertPackage(ds, 100);
    // The provider holds 5 SMS; 100 are promised and unused: oversold.
    const [reading] = await ds.query(
      `INSERT INTO sms_provider_balance_readings (sms_balance) VALUES (5) RETURNING id`,
    );
    try {
      const refused = await buyPackage(B, { package_id: pkg }).expect(409);
      expect(refused.body).toMatchObject({
        message: 'SMS sales are paused for now',
        details: { code: 'SMS_SALES_PAUSED' },
      });
      expect(await send(A)).toEqual({ ok: true });
    } finally {
      await ds.query(`DELETE FROM sms_provider_balance_readings WHERE id = $1`, [reading.id]);
    }
    await expectLedgerInvariant(ds, A.id);
  });

  // 400: the strict ValidationPipe rejects the unknown field `coupon_code` (the contract, not a silent ignore).
  it('a coupon code on a package order is refused, never applied', async () => {
    const code = await newCoupon(50);
    const pkg = await insertPackage(ds, 100);
    const res = await buyPackage(A, { package_id: pkg, coupon_code: code }).expect(400);
    expect(JSON.stringify(res.body)).not.toContain(code);
    const [{ orders, redemptions }] = await ds.query(
      `SELECT (SELECT count(*)::int FROM sms_bundle_orders WHERE school_id = $1) AS orders,
              (SELECT count(*)::int FROM coupon_redemptions) AS redemptions`,
      [A.id],
    );
    expect({ orders, redemptions }).toEqual({ orders: 0, redemptions: 0 });
    const [{ uses }] = await ds.query('SELECT uses_count AS uses FROM coupons WHERE code = $1', [
      code,
    ]);
    expect(uses).toBe(0);
    await expectLedgerInvariant(ds, A.id);
  });

  it("school A cannot read or pay school B's package orders and cannot see its lots", async () => {
    const { order } = await activePackageOrder(B, 100);
    const [lot] = await ds.query('SELECT id FROM sms_credit_lots WHERE tenant_id = $1', [B.id]);
    const pending = (await buyPackage(B, { package_id: await insertPackage(ds, 150) }).expect(201))
      .body;
    // 404, the same answer as an unknown id: school A learns nothing about B's orders (Rule 23).
    const refused = (r: { status: number }) => r.status === 404;
    for (const id of [order.id, pending.id]) {
      expect(refused(await asSchool(A, m.http().get(`${API}/sms-bundles/orders/${id}`)))).toBe(
        true,
      );
      expect(
        refused(await asSchool(A, m.http().get(`${API}/sms-bundles/orders/${id}/receipt`))),
      ).toBe(true);
      expect(
        refused(await asSchool(A, m.http().post(`${API}/sms-bundles/orders/${id}/pay/bkash`))),
      ).toBe(true);
    }
    // A's own list and credits page never show B's orders or lot.
    const list = await asSchool(A, m.http().get(`${API}/sms-bundles/orders`)).expect(200);
    const credits = await asSchool(A, m.http().get(`${API}/communications/sms-credits`)).expect(
      200,
    );
    for (const id of [order.id, pending.id, lot.id]) {
      expect(JSON.stringify(list.body)).not.toContain(id);
      expect(JSON.stringify(credits.body)).not.toContain(id);
    }
    // B's token with A's tenant header is not a member of A.
    const wrongHeader = await m
      .http()
      .get(`${API}/sms-bundles/orders/${order.id}`)
      .set('Authorization', `Bearer ${B.token}`)
      .set('X-Tenant-ID', A.id);
    expect(wrongHeader.status).toBe(401); // not a member of A
    // B's pending order is still pending: nothing A did started a payment.
    const [{ status }] = await ds.query('SELECT status FROM sms_bundle_orders WHERE id = $1', [
      pending.id,
    ]);
    expect(status).toBe('PENDING_PAYMENT');
    await expectLedgerInvariant(ds, B.id);
  });

  it('a missing or invalid X-Tenant-ID is refused on every school money route', async () => {
    const id = randomUUID();
    const routes: Array<['get' | 'post', string]> = [
      ['get', 'sms-bundles/catalog'],
      ['get', 'sms-bundles/orders'],
      ['get', `sms-bundles/orders/${id}`],
      ['get', `sms-bundles/orders/${id}/receipt`],
      ['post', 'sms-bundles/orders'],
      ['post', `sms-bundles/orders/${id}/pay/bkash`],
      ['get', 'communications/sms-credits'],
      ['get', 'billing/summary'],
      ['get', 'billing/orders'],
      ['post', 'billing/orders'],
      ['post', 'billing/orders/preview'],
      ['post', `billing/orders/${id}/pay/bkash`],
    ];
    for (const [method, path] of routes) {
      for (const tenant of [null, 'not-a-uuid']) {
        const req = m.http()[method](`${API}/${path}`).set('Authorization', `Bearer ${A.token}`);
        if (tenant !== null) req.set('X-Tenant-ID', tenant);
        const res = await req.send({});
        // Pinned, not a range: a valid tenant plus an empty body is also a 400, so only the
        // exact 401 and its sentence prove the tenant guard (not the body check) answered.
        expect(res.status, `${method} ${path} tenant=${tenant}`).toBe(401);
        expect(res.body.message).toBe(
          tenant === null
            ? 'X-Tenant-ID header is required'
            : 'User is not a member of the requested tenant',
        );
      }
    }

    await expectLedgerInvariant(ds, A.id);
  });

  it('with Redis down a package buy, a coupon on a seat order and a refund each answer 503, and an SMS send is unaffected', async () => {
    const { order } = await activePackageOrder(A, 100);
    const pkg = await insertPackage(ds, 100);
    const code = await newCoupon(50);
    const before = await ds.query('SELECT count(*)::int AS n FROM sms_bundle_orders');
    redis.down = true;
    try {
      await buyPackage(B, { package_id: pkg }).expect(503);
      const coupon = await seatOrder(B, { coupon_code: code }).expect(503);
      expect(coupon.body.details).toEqual({ code: 'COUPON_CHECK_UNAVAILABLE' });
      expect(JSON.stringify(coupon.body)).not.toContain(code);
      await owner(`/billing/sms-bundle-orders/${order.id}/refund`, {
        reason: 'Redis is down',
      }).expect(503);
      // The send path never touches Redis.
      expect(await send(A)).toEqual({ ok: true });
    } finally {
      redis.down = false;
    }
    // Nothing moved: no new order, no coupon use, the refunded order is still ACTIVE.
    expect(await ds.query('SELECT count(*)::int AS n FROM sms_bundle_orders')).toEqual(before);
    const [{ uses }] = await ds.query('SELECT uses_count AS uses FROM coupons WHERE code = $1', [
      code,
    ]);
    expect(uses).toBe(0);
    const [{ status }] = await ds.query('SELECT status FROM sms_bundle_orders WHERE id = $1', [
      order.id,
    ]);
    expect(status).toBe('ACTIVE');
    await expectLedgerInvariant(ds, A.id);
  });

  it('wrong coupon codes past the limit get the wait sentence, even for a right code', async () => {
    const school = await createMoneySchool(m, 'c');
    const good = await newCoupon(50);
    for (let i = 0; i < COUPON_FAIL_LIMIT; i++) {
      await seatOrder(school, { coupon_code: `E2E-WRONG-${i}` }).expect(400);
    }
    const wait = await seatOrder(school, { coupon_code: 'E2E-WRONG-LAST' }).expect(429);
    expect(wait.body).toMatchObject({
      message: 'Too many coupon tries. Please try again later.',
      details: { code: 'COUPON_TRY_LATER' },
    });
    // A success does not reset the count: the right code waits too.
    await seatOrder(school, { coupon_code: good }).expect(429);
    // Another school is not affected.
    await seatOrder(A, { coupon_code: good }).expect(201);
    await expectLedgerInvariant(ds, A.id);
  });

  it('error bodies never echo the submitted coupon code or idempotency key', async () => {
    const wrongCode = `E2E-SECRETCODE-${randomUUID().slice(0, 6)}`;
    const wrong = await seatOrder(B, { coupon_code: wrongCode }).expect(400);
    expect(JSON.stringify(wrong.body)).not.toContain(wrongCode);

    // The same idempotency key for a different package is a 409 that names neither.
    const key = randomUUID();
    const first = await insertPackage(ds, 100);
    const other = await insertPackage(ds, 200);
    await buyPackage(A, { package_id: first, idempotency_key: key }).expect(201);
    const reused = await buyPackage(A, { package_id: other, idempotency_key: key }).expect(409);
    expect(reused.body.details).toEqual({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(JSON.stringify(reused.body)).not.toContain(key);

    // A package id that does not exist is the fixed sentence, not the id.
    const missing = randomUUID();
    const gone = await buyPackage(A, { package_id: missing }).expect(400);
    expect(JSON.stringify(gone.body)).not.toContain(missing);
    await expectLedgerInvariant(ds, A.id);
  });
});
