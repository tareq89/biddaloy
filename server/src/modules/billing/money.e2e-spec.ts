import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { OTP_REDIS } from '../account-access/otp.service';
import { ApprovalGuard } from '../auth/guards/approval.guard';
import { BkashClient, paisaToBdt } from './bkash/bkash.client';
import { PAYMENT_KEY } from './bkash/bkash.service';
import { mintCockpitToken, removeCockpitOwners } from '@test/helpers/cockpit-token.helper';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

const API = '/api/v1';

/**
 * [Epic 100 #3875] The money paths of Wave 3 end to end over HTTP: the last coupon use, a double
 * bKash callback, a 100 percent coupon, a refund (and what it keeps), and a plan change.
 *
 * Two stand-ins, both on purpose: bKash itself (`BkashClient`, no network) and the step-up
 * `ApprovalGuard` (its own 403 is pinned in platform-billing.controller.e2e-spec.ts; here it
 * would only be an OTP round trip in front of the refund we want to see run).
 */
describe('cockpit money E2E (#3875)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let redis: Redis;
  let ownerToken: string;
  const completed = new Map<string, Record<string, unknown>>();
  const bkash = {
    query: vi.fn(async (id: string) => completed.get(id)),
    execute: vi.fn(),
    isConfigured: () => false,
  };

  const school = (n: string) => ({
    id: randomUUID(),
    adminId: randomUUID(),
    email: `${n}-${randomUUID().slice(0, 8)}@money-e2e.example`,
    token: '',
  });
  const A = school('a');
  const B = school('b');
  const code = (n: string) => `E2E-${n}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const http = () => supertest(app.getHttpServer());

  const createOrder = (s: typeof A, body: Record<string, unknown>) =>
    http()
      .post(`${API}/billing/orders`)
      .set('Authorization', `Bearer ${s.token}`)
      .set('X-Tenant-ID', s.id)
      .send({ seats: 10, months: 1, idempotency_key: randomUUID(), ...body });
  const owner = (path: string, body: object, key = randomUUID()) =>
    http()
      .post(`${API}/platform${path}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', key)
      .send(body);
  const order = async (id: string) =>
    (
      await ds.query(
        `SELECT status, amount_paisa::text AS amount, unit_price_paisa AS unit, receipt_number
           FROM seat_orders WHERE id = $1`,
        [id],
      )
    )[0];
  const newCoupon = async (c: string, percent: number, maxUses: number | null) => {
    const [row] = await ds.query(
      `INSERT INTO coupons (code, discount_kind, percent, scope, max_uses, starts_at, ends_at)
       VALUES ($1, 'PERCENT', $2, 'ALL', $3, now() - interval '1 day', now() + interval '1 day')
       RETURNING id`,
      [c, percent, maxUses],
    );
    return row.id as string;
  };
  const usesCount = async (id: string) =>
    (await ds.query('SELECT uses_count FROM coupons WHERE id = $1', [id]))[0].uses_count as number;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BkashClient)
      .useValue(bkash)
      .overrideGuard(ApprovalGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = fixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    redis = app.get<Redis>(OTP_REDIS);

    for (const s of [A, B]) {
      await ds.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [s.id, `Money E2E ${s.id}`, `money-e2e-${s.id}`],
      );
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Money E2E', 'ACTIVE', NOW(), NOW())`,
        [s.adminId, s.email, SEED_ADMIN_PASSWORD_HASH],
      );
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [s.adminId, s.id, UserRole.ADMIN],
      );
      s.token = (
        await http()
          .post(`${API}/auth/login`)
          .send({ email: s.email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token;
    }
    ownerToken = await mintCockpitToken(app, ds);
  }, 90_000);

  afterAll(async () => {
    await removeCockpitOwners(ds);
    const ids = [A.id, B.id];
    await ds.query('DELETE FROM coupon_redemptions WHERE school_id = ANY($1)', [ids]);
    await ds.query(
      'DELETE FROM platform_payments WHERE seat_order_id IN (SELECT id FROM seat_orders WHERE school_id = ANY($1))',
      [ids],
    );
    await ds.query('DELETE FROM seat_orders WHERE school_id = ANY($1)', [ids]);
    await ds.query(`DELETE FROM coupons WHERE code LIKE 'E2E-%'`);
    await ds.query('DELETE FROM user_tenants WHERE tenant_id = ANY($1)', [ids]);
    await app.close();
  });

  it('the last use of a coupon goes to one of two racing schools; the other gets the one fixed refusal', async () => {
    const c = code('LAST');
    const couponId = await newCoupon(c, 10, 1);
    const [a, b] = await Promise.all([
      createOrder(A, { coupon_code: c }),
      createOrder(B, { coupon_code: c }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    const loser = a.status === 400 ? a : b;
    expect(JSON.stringify(loser.body)).not.toContain(c);
    expect(await usesCount(couponId)).toBe(1);
    const loserSchool = a.status === 400 ? A : B;
    const [{ orders }] = await ds.query(
      `SELECT count(*)::int AS orders FROM seat_orders WHERE school_id = $1 AND coupon_id = $2`,
      [loserSchool.id, couponId],
    );
    expect(orders).toBe(0);
    const [{ n }] = await ds.query(
      'SELECT count(*)::int AS n FROM coupon_redemptions WHERE coupon_id = $1',
      [couponId],
    );
    expect(n).toBe(1);
  });

  it('a 100 percent coupon is PAID at once with a receipt and no bKash call', async () => {
    bkash.query.mockClear();
    const res = await createOrder(A, { coupon_code: await freeCode() }).expect(201);
    expect(res.body).toMatchObject({ status: 'PAID', amount_paisa: 0 });
    const o = await order(res.body.id);
    expect(o.receipt_number).toMatch(/^SMR-\d{4}-\d{6}$/);
    const [p] = await ds.query(
      'SELECT method, amount_paisa::text AS amount FROM platform_payments WHERE seat_order_id = $1',
      [res.body.id],
    );
    expect(p).toEqual({ method: 'COUPON', amount: '0' });
    expect(bkash.query).not.toHaveBeenCalled();
    expect(bkash.execute).not.toHaveBeenCalled();

    // Owner decision: a zero-price order has nothing to pay back.
    const refund = await owner(`/billing/orders/${res.body.id}/refund`, {
      reason: 'Trying to refund a free order',
    }).expect(409);
    expect(refund.body.details).toEqual({ code: 'ORDER_NOT_REFUNDABLE' });
    expect((await order(res.body.id)).status).toBe('PAID');
  });

  async function freeCode() {
    const c = code('FREE');
    await newCoupon(c, 100, null);
    return c;
  }

  it('a double bKash callback pays once; the refund then closes the order and names the bKash transaction', async () => {
    const created = await createOrder(B, {}).expect(201);
    const id = created.body.id as string;
    const amount = (await order(id)).amount as string;
    const paymentID = `PAY${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const trxID = `TRX${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    await redis.set(`bkash:pid:${paymentID}`, id, 'EX', 600);
    await redis.set(
      PAYMENT_KEY(id),
      JSON.stringify({ paymentID, pay_started_at: new Date().toISOString() }),
      'EX',
      600,
    );
    completed.set(paymentID, {
      statusCode: '0000',
      paymentID,
      trxID,
      merchantInvoiceNumber: id,
      transactionStatus: 'Completed',
      amount: paisaToBdt(amount),
      currency: 'BDT',
    });

    const cb = () =>
      http().get(`${API}/billing/bkash/callback?paymentID=${paymentID}&status=success`);
    const [first, second] = await Promise.all([cb(), cb()]);
    for (const r of [first, second]) {
      expect(r.status).toBe(302);
      expect(r.headers.location).toContain('payment=success');
    }
    expect((await cb()).headers.location).toContain('payment=success');
    const payments = await ds.query(
      `SELECT gateway_ref, raw->>'orphan' AS orphan FROM platform_payments WHERE seat_order_id = $1`,
      [id],
    );
    expect(payments).toEqual([{ gateway_ref: trxID, orphan: null }]);
    const paid = await order(id);
    expect(bkash.execute).not.toHaveBeenCalled(); // already Completed per query: idempotency, not parallelism
    expect(paid.status).toBe('PAID');
    expect(paid.receipt_number).not.toBeNull();

    // A school token is never a refund.
    await http()
      .post(`${API}/platform/billing/orders/${id}/refund`)
      .set('Authorization', `Bearer ${B.token}`)
      .set('X-Tenant-ID', B.id)
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'School tries to refund itself' })
      .expect(403);

    const key = randomUUID();
    const refunded = await owner(
      `/billing/orders/${id}/refund`,
      { reason: 'Paid twice by mistake' },
      key,
    ).expect(200);
    expect(refunded.body).toMatchObject({ applied: true, order_id: id, gateway_ref: trxID });
    expect((await order(id)).status).toBe('REFUNDED');
    // Same key: the same answer. New key: nothing more happens.
    expect(
      (
        await owner(
          `/billing/orders/${id}/refund`,
          { reason: 'Paid twice by mistake' },
          key,
        ).expect(200)
      ).body.applied,
    ).toBe(true);
    const again = await owner(`/billing/orders/${id}/refund`, {
      reason: 'Paid twice by mistake',
    }).expect(200);
    expect(again.body.applied).toBe(false);
    await redis.del(`bkash:pid:${paymentID}`, PAYMENT_KEY(id));
  });

  it('a refund keeps the coupon use', async () => {
    const c = code('HALF');
    const couponId = await newCoupon(c, 50, 5);
    const created = await createOrder(A, { coupon_code: c }).expect(201);
    expect(created.body).toMatchObject({ status: 'PENDING', amount_paisa: 5000 });
    await owner(`/billing/orders/${created.body.id}/offline-payment`, {
      method: 'OFFLINE_CASH',
      reference: `E2E${randomUUID().slice(0, 8)}`,
      idempotency_key: randomUUID(),
    }).expect(200);
    await owner(`/billing/orders/${created.body.id}/refund`, {
      reason: 'Customer changed their mind',
    }).expect(200);
    expect((await order(created.body.id)).status).toBe('REFUNDED');
    expect(await usesCount(couponId)).toBe(1);
  });

  it('a plan change prices the next order only', async () => {
    const [plus] = await ds.query(
      `INSERT INTO plans (name, unit_price_paisa) VALUES ($1, 1500) RETURNING id`,
      [`E2E Plus ${randomUUID().slice(0, 6)}`],
    );
    const before = await createOrder(B, { seats: 4, months: 2 }).expect(201);
    await owner(`/billing/schools/${B.id}/plan`, {
      plan_id: plus.id,
      reason: 'Upgraded to Plus',
    }).expect(200);
    const after = await createOrder(B, { seats: 4, months: 2 }).expect(201);
    expect(await order(before.body.id)).toMatchObject({ unit: 1000, amount: '8000' });
    expect(await order(after.body.id)).toMatchObject({ unit: 1500, amount: '12000' });
    await ds.query('UPDATE schools SET plan_id = $2 WHERE id = $1', [
      B.id,
      '00000000-0000-4000-8000-000000000001',
    ]);
    await ds.query('DELETE FROM seat_orders WHERE id = ANY($1)', [[before.body.id, after.body.id]]);
    await ds.query('DELETE FROM plans WHERE id = $1', [plus.id]);
  });

  it('a school token reaches no money route of another school', async () => {
    const mine = await createOrder(A, {}).expect(201);
    const refused = (r: { status: number }) =>
      // 503 is the unconfigured gateway answering before it looks at the order: nothing started.
      expect([400, 401, 403, 404, 503]).toContain(r.status);
    const asB = (r: supertest.Test) =>
      r.set('Authorization', `Bearer ${B.token}`).set('X-Tenant-ID', B.id);
    // B's own header, A's order.
    await asB(http().get(`${API}/billing/orders/${mine.body.id}/receipt`)).expect(refused);
    await asB(http().post(`${API}/billing/orders/${mine.body.id}/pay/bkash`)).expect(refused);
    // B's token with A's header: not a member.
    await http()
      .get(`${API}/billing/orders`)
      .set('Authorization', `Bearer ${B.token}`)
      .set('X-Tenant-ID', A.id)
      .expect(refused);
    const list = await asB(http().get(`${API}/billing/orders`)).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(mine.body.id);
  });
});
