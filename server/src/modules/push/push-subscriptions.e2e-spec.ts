import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * [TEN-05] One device, two schools: the same user subscribes the same
 * browser endpoint under two `X-Tenant-ID`s and keeps one row in each.
 */
describe('Push subscriptions per tenant E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = randomUUID();
  const API = '/api/v1';
  const ENDPOINT = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  const body = { endpoint: ENDPOINT, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } };

  const asTenant = (req: supertest.Test, tenantId: string) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', tenantId);

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

    // A second school where the same admin is also a member.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Push Other School', $2, NOW(), NOW())`,
      [TENANT_B, `push-other-${TENANT_B}`],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [SEED_ADMIN_USER_ID, TENANT_B, UserRole.ADMIN],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [ENDPOINT]);
    await dataSource.query(`DELETE FROM user_tenants WHERE tenant_id = $1`, [TENANT_B]);
    await dataSource.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await app.close();
  });

  it('keeps one row per tenant for the same endpoint, and never leaks across tenants', async () => {
    await asTenant(supertest(app.getHttpServer()).post(`${API}/me/push/subscriptions`), TENANT_A)
      .send(body)
      .expect(201);
    await asTenant(supertest(app.getHttpServer()).post(`${API}/me/push/subscriptions`), TENANT_B)
      .send(body)
      .expect(201);

    const listA = await asTenant(
      supertest(app.getHttpServer()).get(`${API}/me/push/subscriptions`),
      TENANT_A,
    ).expect(200);
    const listB = await asTenant(
      supertest(app.getHttpServer()).get(`${API}/me/push/subscriptions`),
      TENANT_B,
    ).expect(200);

    expect(listA.body).toHaveLength(1);
    expect(listB.body).toHaveLength(1);
    // Tenant isolation: B's list never shows A's row.
    expect(listB.body[0].id).not.toBe(listA.body[0].id);

    const rows = await dataSource.query(
      `SELECT tenant_id FROM push_subscriptions WHERE endpoint = $1 ORDER BY tenant_id`,
      [ENDPOINT],
    );
    expect(rows.map((r: { tenant_id: string }) => r.tenant_id).sort()).toEqual(
      [TENANT_A, TENANT_B].sort(),
    );
  });

  it('re-subscribing in the same tenant does not add a second row', async () => {
    await asTenant(supertest(app.getHttpServer()).post(`${API}/me/push/subscriptions`), TENANT_A)
      .send(body)
      .expect(201);
    const listA = await asTenant(
      supertest(app.getHttpServer()).get(`${API}/me/push/subscriptions`),
      TENANT_A,
    ).expect(200);
    expect(listA.body).toHaveLength(1);
  });

  it('rejects a non-member and a nonexistent X-Tenant-ID with 401', async () => {
    const stranger = randomUUID();
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Push Stranger School', $2, NOW(), NOW())`,
      [stranger, `push-stranger-${stranger}`],
    );
    try {
      // Real school, but the caller is not a member.
      await asTenant(
        supertest(app.getHttpServer()).get(`${API}/me/push/subscriptions`),
        stranger,
      ).expect(401);
      // No such school at all.
      await asTenant(
        supertest(app.getHttpServer()).get(`${API}/me/push/subscriptions`),
        randomUUID(),
      ).expect(401);
    } finally {
      await dataSource.query(`DELETE FROM schools WHERE id = $1`, [stranger]);
    }
  });

  it("a different user claiming the endpoint over HTTP removes the first user's rows in every tenant", async () => {
    // Make sure user 1 holds the endpoint in both tenants.
    for (const t of [TENANT_A, TENANT_B]) {
      await asTenant(supertest(app.getHttpServer()).post(`${API}/me/push/subscriptions`), t)
        .send(body)
        .expect(201);
    }
    const otherId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Push Claimer', 'ACTIVE', NOW(), NOW())`,
      [otherId, `push-claimer-${otherId}@example.com`, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [otherId, TENANT_A, UserRole.ADMIN],
    );
    try {
      const login = await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: `push-claimer-${otherId}@example.com`, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      await supertest(app.getHttpServer())
        .post(`${API}/me/push/subscriptions`)
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .set('X-Tenant-ID', TENANT_A)
        .send(body)
        .expect(201);

      const rows = await dataSource.query(
        `SELECT user_id, tenant_id FROM push_subscriptions WHERE endpoint = $1`,
        [ENDPOINT],
      );
      // Only the claimer's row in A remains; user 1's rows in A and B are gone.
      expect(rows).toEqual([{ user_id: otherId, tenant_id: TENANT_A }]);
    } finally {
      await dataSource.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [otherId]);
      await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [otherId]);
      // The user row stays: login wrote an append-only audit_logs row that references it.
    }
  });

  it('rejects a request with no X-Tenant-ID', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/me/push/subscriptions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
