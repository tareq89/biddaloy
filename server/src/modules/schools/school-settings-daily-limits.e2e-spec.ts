import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

const TENANT_B = '00000000-0000-4000-8000-00000000d601';
const ADMIN_B_ID = '00000000-0000-4000-8000-00000000d602';
const ADMIN_B_EMAIL = 'daily-limits-admin-b@e2e.example';
const API = '/api/v1';

/**
 * [60.0 D17/D35] `communications.dailyLimits` is platform-only to change.
 * A school ADMIN may read it and resend it unchanged, never change it.
 */
describe('School settings daily limits (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let tokenB: string;
  let dataSource: DataSource;

  const patch = (body: object, bearer = token, tenant = SEED_TENANT_ID, school = SEED_TENANT_ID) =>
    supertest(app.getHttpServer())
      .patch(`${API}/schools/${school}/settings`)
      .set('Authorization', `Bearer ${bearer}`)
      .set('X-Tenant-ID', tenant)
      .send({ version: 1, ...body });

  const get = (bearer = token, tenant = SEED_TENANT_ID, school = SEED_TENANT_ID) =>
    supertest(app.getHttpServer())
      .get(`${API}/schools/${school}/settings`)
      .set('Authorization', `Bearer ${bearer}`)
      .set('X-Tenant-ID', tenant);

  const storedLimits = async () => {
    const rows = await dataSource.query(
      `SELECT settings->'communications'->'dailyLimits' AS d FROM schools WHERE id = $1`,
      [SEED_TENANT_ID],
    );
    return rows[0].d;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);
    const login = (email: string) =>
      supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
    token = (await login(SEED_ADMIN_EMAIL)).body.access_token;
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Daily Limits School B', 'daily-limits-b', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Daily Limits B', 'ACTIVE', NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, status = 'ACTIVE'`,
      [ADMIN_B_ID, ADMIN_B_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [ADMIN_B_ID, TENANT_B, UserRole.ADMIN],
    );
    tokenB = (await login(ADMIN_B_EMAIL)).body.access_token;
    // The platform route (#4254) is the only writer; seed the stored value directly.
    await dataSource.query(
      `UPDATE schools SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb), '{communications}',
         COALESCE(settings->'communications','{}'::jsonb) || '{"dailyLimits":{"sms":50}}'::jsonb)
       WHERE id = $1`,
      [SEED_TENANT_ID],
    );
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.query(
        `UPDATE schools SET settings = settings #- '{communications,dailyLimits}' WHERE id = $1`,
        [SEED_TENANT_ID],
      );
      await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [ADMIN_B_ID]);
      await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [ADMIN_B_ID]);
      await dataSource.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [ADMIN_B_ID]);
      await dataSource.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    }
    await app?.close();
  });

  it('school ADMIN changing dailyLimits gets 403 and the stored value is unchanged', async () => {
    await patch({ communications: { dailyLimits: { sms: 5000 } } }).expect(403);
    expect(await storedLimits()).toEqual({ sms: 50 });
  });

  it('school ADMIN resending the stored dailyLimits unchanged gets 200', async () => {
    await patch({ communications: { dailyLimits: { sms: 50 } } }).expect(200);
    expect(await storedLimits()).toEqual({ sms: 50 });
  });

  it('school ADMIN saving without dailyLimits gets 200 and the limits survive', async () => {
    await patch({ documents: { withholdAdmitCardForDues: false } }).expect(200);
    expect(await storedLimits()).toEqual({ sms: 50 });
  });

  it('school ADMIN GET shows the limits', async () => {
    const res = await get().expect(200);
    expect(res.body.communications.dailyLimits).toEqual({ sms: 50 });
  });

  it('a missing or invalid X-Tenant-ID is rejected', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/schools/${SEED_TENANT_ID}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await get(token, 'not-a-uuid').expect(401);
  });

  it("tenant B's admin cannot read tenant A's settings", async () => {
    // ContextGuard refuses a tenant the caller does not belong to; the id-vs-tenant check backs it.
    await get(tokenB, SEED_TENANT_ID, SEED_TENANT_ID).expect(401);
    await get(tokenB, TENANT_B, SEED_TENANT_ID).expect(403);
  });
});
