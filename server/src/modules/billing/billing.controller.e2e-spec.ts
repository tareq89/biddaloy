import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole, type BillingSummary } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

const TENANT_ID = '00000000-0000-4000-8000-0000002716a1';
const ADMIN = { id: '00000000-0000-4000-8000-0000002716a2', email: 'a@billing-e2e.example' };
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000002716b1';
const TEACHER = { id: '00000000-0000-4000-8000-0000002716a3', email: 't@billing-e2e.example' };

/** [#2716] GET /billing/summary and /billing/orders: SETTINGS_MANAGE only, own school only. */
describe('billing E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const tokens: Record<string, string> = {};

  const get = (path: string, token: string) =>
    supertest(app.getHttpServer())
      .get(`/api/v1/billing/${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID);

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Billing E2E School', 'billing-e2e-school', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_ID],
    );
    for (const [user, role] of [
      [ADMIN, UserRole.ADMIN],
      [TEACHER, UserRole.TEACHER],
    ] as const) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Billing E2E', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [user.id, user.email, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [user.id, TENANT_ID, role],
      );
    }
    const loginAs = async (email: string) =>
      (
        await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token as string;
    tokens.admin = await loginAs(ADMIN.email);
    tokens.teacher = await loginAs(TEACHER.email);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('refuses a TEACHER (403) and a missing token (401)', async () => {
    await get('summary', tokens.teacher).expect(403);
    await get('orders', tokens.teacher).expect(403);
    await supertest(app.getHttpServer()).get('/api/v1/billing/summary').expect(401);
  });

  it('gives an ADMIN the summary with no orders yet', async () => {
    const { body } = await get('summary', tokens.admin).expect(200);
    const summary = body as BillingSummary;
    expect(summary).toMatchObject({ seats_bought: 0, seats_used: 0, paid_until: null, orders: [] });
    expect(typeof summary.free_until).toBe('string');
  });

  it('a missing or invalid X-Tenant-ID is refused, and another school is not readable', async () => {
    const refused = (r: { status: number }) => expect([400, 401, 403]).toContain(r.status);
    await supertest(app.getHttpServer())
      .get('/api/v1/billing/summary')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(refused);
    await supertest(app.getHttpServer())
      .get('/api/v1/billing/summary')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .set('X-Tenant-ID', 'not-a-uuid')
      .expect(refused);
    // A school the ADMIN is not a member of: never its data.
    await supertest(app.getHttpServer())
      .get('/api/v1/billing/orders')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .set('X-Tenant-ID', OTHER_TENANT_ID)
      .expect(refused);
  });

  it('caps the orders limit at 100 and rejects a bad one with 400', async () => {
    await get('orders?limit=100', tokens.admin).expect(200);
    await get('orders?limit=101', tokens.admin).expect(400);
  });

  it('POST /billing/orders: ADMIN creates a PENDING order, retry is idempotent, bad input 400, TEACHER 403', async () => {
    const post = (token: string, body: object) =>
      supertest(app.getHttpServer())
        .post('/api/v1/billing/orders')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send(body);
    const key = '3f2b8c1e-5d4a-4b6e-9c7d-1a2b3c4d5e6f';
    const a = await post(tokens.admin, { seats: 100, months: 3, idempotency_key: key }).expect(201);
    expect(a.body).toMatchObject({
      status: 'PENDING',
      seats: 100,
      months: 3,
      amount_paisa: 300000,
    });
    const b = await post(tokens.admin, { seats: 100, months: 3, idempotency_key: key }).expect(201);
    expect(b.body.id).toBe(a.body.id);
    // Same key, different body: a client bug, refused with fixed text.
    const reused = await post(tokens.admin, { seats: 5, months: 1, idempotency_key: key }).expect(
      409,
    );
    expect(reused.body.details).toEqual({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await post(tokens.admin, { seats: 0, months: 3, idempotency_key: key }).expect(400);
    await post(tokens.admin, { seats: 1, months: 25, idempotency_key: key }).expect(400);
    await post(tokens.admin, { seats: 1, months: 1, idempotency_key: 'nope' }).expect(400);
    await post(tokens.teacher, { seats: 1, months: 1, idempotency_key: key }).expect(403);
  });
});
