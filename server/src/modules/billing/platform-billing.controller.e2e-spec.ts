import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

const API = '/api/v1/platform/billing';
const SUPER = {
  id: '00000000-0000-4000-8000-0000002719a1',
  email: 'sa@platform-billing-e2e.example',
};
const ADMIN = {
  id: '00000000-0000-4000-8000-0000002719a2',
  email: 'a@platform-billing-e2e.example',
};
const LOCAL_SUPER = {
  id: '00000000-0000-4000-8000-0000002719a3',
  email: 'ls@platform-billing-e2e.example',
};

/** Epic 49 W4: platform-only billing routes. Tenant ADMIN and a school-local SUPER_ADMIN get 403. */
describe('platform billing E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let platformId = '';
  const schoolId = randomUUID();
  const tokens: Record<string, string> = {};

  const as = (who: 'super' | 'admin' | 'localSuper') => {
    const tenant = who === 'super' ? platformId : schoolId;
    const role = who === 'admin' ? UserRole.ADMIN : UserRole.SUPER_ADMIN;
    const set = (r: supertest.Test) =>
      r
        .set('Authorization', `Bearer ${tokens[who]}`)
        .set('X-Tenant-ID', tenant)
        .set('X-Role', role);
    const http = supertest(app.getHttpServer());
    return {
      get: (path: string) => set(http.get(`${API}/${path}`)),
      post: (path: string, body: object = {}) => set(http.post(`${API}/${path}`)).send(body),
    };
  };

  const newPendingOrder = async (seats = 40, months = 3) =>
    (
      await ds.query(
        `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start,
                                  period_end, status, idempotency_key)
         VALUES ($1, $2, $3, 1000, $4, CURRENT_DATE, CURRENT_DATE + 90, 'PENDING', $5) RETURNING id`,
        [schoolId, seats, months, seats * months * 1000, randomUUID()],
      )
    )[0].id as string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    for (const u of [SUPER, ADMIN, LOCAL_SUPER]) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Platform Billing E2E', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, u.email, SEED_ADMIN_PASSWORD_HASH],
      );
    }
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       SELECT $1, 'Platform', 'default-school', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM schools WHERE slug = 'default-school')`,
      [randomUUID()],
    );
    platformId = (await ds.query(`SELECT id FROM schools WHERE slug = 'default-school'`))[0].id;
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Platform Billing E2E School', $2, NOW(), NOW())`,
      [schoolId, `platform-billing-e2e-${schoolId}`],
    );
    for (const [u, tenant, role] of [
      [SUPER, platformId, UserRole.SUPER_ADMIN],
      [ADMIN, schoolId, UserRole.ADMIN],
      [LOCAL_SUPER, schoolId, UserRole.SUPER_ADMIN],
    ] as const) {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, tenant, role],
      );
    }
    const login = async (email: string) =>
      (
        await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token as string;
    tokens.super = await login(SUPER.email);
    tokens.admin = await login(ADMIN.email);
    tokens.localSuper = await login(LOCAL_SUPER.email);
  }, 60_000);

  afterAll(async () => {
    await ds.query(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [
      [SUPER.id, ADMIN.id, LOCAL_SUPER.id],
    ]);
    await app.close();
  });

  it('refuses a school ADMIN and a school-local SUPER_ADMIN (403) on all four routes', async () => {
    const orderId = await newPendingOrder();
    const body = {
      method: 'OFFLINE_CASH',
      reference: 'REF-403-A',
      idempotency_key: 'key-403-aaaa',
    };
    const grant = {
      seats: 5,
      months: 1,
      reason: 'Should never be accepted',
      idempotency_key: 'key-403-bbbb',
    };
    for (const who of ['admin', 'localSuper'] as const) {
      await as(who).get('schools').expect(403);
      await as(who).get(`schools/${schoolId}`).expect(403);
      await as(who).post(`orders/${orderId}/offline-payment`, body).expect(403);
      await as(who).post(`schools/${schoolId}/grant`, grant).expect(403);
    }
    await supertest(app.getHttpServer()).get(`${API}/schools`).expect(401);
    // The refused offline payment did nothing.
    const [o] = await ds.query(`SELECT status FROM seat_orders WHERE id = $1`, [orderId]);
    expect(o.status).toBe('PENDING');
  });

  it('lists schools with entitlement, filters and search; limit > 100 and bad filter are 400', async () => {
    const page = (await as('super').get(`schools?search=Platform Billing E2E`).expect(200))
      .body as {
      items: { id: string; seats_entitled: number; pending_orders: number }[];
      total: number;
    };
    const row = page.items.find((r) => r.id === schoolId)!;
    expect(page.total).toBeGreaterThanOrEqual(1);
    expect(row).toMatchObject({ seats_entitled: 0 });
    // LIKE metacharacters are escaped, not wildcards.
    const wild = (await as('super').get('schools?search=%25').expect(200)).body as {
      items: unknown[];
      total: number;
    };
    expect(wild).toEqual({ items: [], total: 0 });
    // Paging: one row per page, the total stays the full match count.
    const first = (await as('super').get('schools?limit=1&offset=0').expect(200)).body as {
      items: { id: string }[];
      total: number;
    };
    expect(first.items).toHaveLength(1);
    expect(first.total).toBeGreaterThan(1);
    await as('super').get('schools?filter=idle').expect(200);
    await as('super').get('schools?filter=expiring').expect(200);
    await as('super').get('schools?filter=exhausted').expect(200);
    await as('super').get('schools?filter=bogus').expect(400);
    await as('super').get('schools?limit=101').expect(400);
    await as('super').get('schools/not-a-uuid').expect(400);
    await as('super').get(`schools/${randomUUID()}`).expect(404);
  });

  it('offline payment: PAID, entitlement moves, audited; a replay changes nothing', async () => {
    const orderId = await newPendingOrder(40, 3);
    const body = {
      method: 'OFFLINE_BANK',
      reference: `SLIP-${orderId.slice(0, 8)}`,
      idempotency_key: 'offline-key-0001',
    };
    const first = await as('super').post(`orders/${orderId}/offline-payment`, body).expect(200);
    expect(first.body.applied).toBe(true);
    const again = await as('super').post(`orders/${orderId}/offline-payment`, body).expect(200);
    expect(again.body.applied).toBe(false);

    const payments = await ds.query(
      `SELECT method, gateway_ref, recorded_by_user_id FROM platform_payments WHERE seat_order_id = $1`,
      [orderId],
    );
    expect(payments).toEqual([
      { method: 'OFFLINE_BANK', gateway_ref: body.reference, recorded_by_user_id: SUPER.id },
    ]);
    const audits = await ds.query(
      `SELECT 1 FROM audit_logs WHERE entity_id = $1 AND new_values->>'event' = 'OFFLINE_PAYMENT_RECORDED'
          AND new_values->>'order_id' = $2`,
      [schoolId, orderId],
    );
    expect(audits).toHaveLength(1);

    const detail = (await as('super').get(`schools/${schoolId}`).expect(200)).body;
    expect(detail.seats_entitled).toBeGreaterThanOrEqual(40);
    expect(
      detail.orders.some(
        (o: { id: string; method: string }) => o.id === orderId && o.method === 'OFFLINE_BANK',
      ),
    ).toBe(true);
  });

  it('offline payment validation: method, reference, unknown order, non-UUID, reused reference', async () => {
    const orderId = await newPendingOrder();
    const ok = {
      method: 'OFFLINE_CASH',
      reference: 'REF-VALID-1',
      idempotency_key: 'validate-key-1',
    };
    await as('super')
      .post(`orders/${orderId}/offline-payment`, { ...ok, method: 'BKASH' })
      .expect(400);
    await as('super')
      .post(`orders/${orderId}/offline-payment`, { ...ok, reference: 'x' })
      .expect(400);
    await as('super')
      .post(`orders/${orderId}/offline-payment`, { ...ok, extra: 1 })
      .expect(400);
    await as('super').post(`orders/not-a-uuid/offline-payment`, ok).expect(400);
    await as('super').post(`orders/${randomUUID()}/offline-payment`, ok).expect(404);

    await as('super').post(`orders/${orderId}/offline-payment`, ok).expect(200);
    // The same slip on a second order is a conflict; that order stays PENDING.
    const second = await newPendingOrder();
    await as('super').post(`orders/${second}/offline-payment`, ok).expect(409);
    const [o] = await ds.query(`SELECT status FROM seat_orders WHERE id = $1`, [second]);
    expect(o.status).toBe('PENDING');
  });

  it('grant: GRANT order at price 0, audited with the reason; the same key is the same result', async () => {
    const body = {
      seats: 25,
      months: 2,
      reason: 'Pilot school, agreed with the owner',
      idempotency_key: `grant-${randomUUID()}`,
    };
    await as('super').post(`schools/${schoolId}/grant`, body).expect(200);
    await as('super').post(`schools/${schoolId}/grant`, body).expect(200);

    const orders = await ds.query(
      `SELECT o.seats, o.months, p.method, p.amount_paisa FROM seat_orders o
         JOIN platform_payments p ON p.seat_order_id = o.id
        WHERE o.school_id = $1 AND o.idempotency_key = $2`,
      [schoolId, `grant:${body.idempotency_key}`],
    );
    expect(orders).toEqual([{ seats: 25, months: 2, method: 'GRANT', amount_paisa: '0' }]);
    const audits = await ds.query(
      `SELECT new_values FROM audit_logs WHERE entity_id = $1 AND new_values->>'event' = 'SEATS_GRANTED'
          AND new_values->>'reason' = $2`,
      [schoolId, body.reason],
    );
    expect(audits).toHaveLength(1); // the replay wrote no second audit row
  });

  it('grant validation: ranges, short reason, short key, unknown school, non-UUID', async () => {
    const ok = {
      seats: 5,
      months: 1,
      reason: 'A long enough reason',
      idempotency_key: 'grant-valid-1',
    };
    await as('super')
      .post(`schools/${schoolId}/grant`, { ...ok, seats: 0 })
      .expect(400);
    await as('super')
      .post(`schools/${schoolId}/grant`, { ...ok, seats: 100001 })
      .expect(400);
    await as('super')
      .post(`schools/${schoolId}/grant`, { ...ok, months: 25 })
      .expect(400);
    await as('super')
      .post(`schools/${schoolId}/grant`, { ...ok, reason: 'short' })
      .expect(400);
    await as('super')
      .post(`schools/${schoolId}/grant`, { ...ok, idempotency_key: 'k' })
      .expect(400);
    await as('super').post(`schools/${randomUUID()}/grant`, ok).expect(404);
    await as('super').post(`schools/not-a-uuid/grant`, ok).expect(400);
  });

  it('offline payment on an order that is neither PENDING nor PAID is 409 ORDER_NOT_PENDING', async () => {
    const orderId = await newPendingOrder();
    await ds.query(`UPDATE seat_orders SET status = 'FAILED' WHERE id = $1`, [orderId]);
    const res = await as('super')
      .post(`orders/${orderId}/offline-payment`, {
        method: 'OFFLINE_CASH',
        reference: 'REF-FAILED-1',
        idempotency_key: 'failed-key-0001',
      })
      .expect(409);
    expect(res.body.details.code).toBe('ORDER_NOT_PENDING');
  });

  it('a grant reactivates a billing-suspended school and its admin is let in again', async () => {
    const expired = randomUUID();
    await ds.query(
      `INSERT INTO schools (id, name, slug, status, status_reason, created_at, updated_at)
       VALUES ($1, 'Platform Billing E2E Expired', $2, 'SUSPENDED', 'TRIAL_EXPIRED', NOW(), NOW())`,
      [expired, `platform-billing-e2e-${expired}`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'ADMIN', NOW(), NOW())`,
      [ADMIN.id, expired],
    );
    // JWTs embed memberships.
    const adminToken = (
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;
    const students = () =>
      supertest(app.getHttpServer())
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', expired)
        .set('X-Role', UserRole.ADMIN);
    await students().expect(403);

    await as('super')
      .post(`schools/${expired}/grant`, {
        seats: 10,
        months: 1,
        reason: 'Reopened after the owner got in touch',
        idempotency_key: `reopen-${expired}`,
      })
      .expect(200);
    await students().expect(200);
    await ds.query(`DELETE FROM user_tenants WHERE tenant_id = $1`, [expired]);
  });
});
