import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

const TENANT_ID = '00000000-0000-4000-8000-0000003866a1';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000003866b1';
const ADMIN = { id: '00000000-0000-4000-8000-0000003866a2', email: 'a@sms-bundles-e2e.example' };
const TEACHER = { id: '00000000-0000-4000-8000-0000003866a3', email: 't@sms-bundles-e2e.example' };

/**
 * [Epic 100 #3866] The school-side SMS routes: the app boots with the module wired, a school
 * admin reads its own catalog and source, a teacher is refused, and another school's tenant id
 * or a missing/invalid X-Tenant-ID gets no answer.
 */
describe('sms-bundles E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const tokens: Record<string, string> = {};

  const call = (method: 'get' | 'put', path: string, token?: string, tenant: string | null = TENANT_ID) => {
    const req = supertest(app.getHttpServer())[method](`/api/v1/${path}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (tenant !== null) req.set('X-Tenant-ID', tenant);
    return req;
  };

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

    for (const [id, slug] of [
      [TENANT_ID, 'sms-bundles-e2e'],
      [OTHER_TENANT_ID, 'sms-bundles-e2e-other'],
    ]) {
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, 'SMS Bundles E2E', $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, slug],
      );
    }
    for (const [user, role] of [
      [ADMIN, UserRole.ADMIN],
      [TEACHER, UserRole.TEACHER],
    ] as const) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'SMS Bundles E2E', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
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

  it('gives an ADMIN the catalog, the orders and the SMS source', async () => {
    await call('get', 'sms-bundles/catalog', tokens.admin).expect(200);
    await call('get', 'sms-bundles/orders', tokens.admin).expect(200);
    await call('get', 'communications/sms-source', tokens.admin).expect(200);
  });

  it('refuses a TEACHER (403) and a missing token (401)', async () => {
    await call('get', 'sms-bundles/catalog', tokens.teacher).expect(403);
    await call('get', 'sms-bundles/orders', tokens.teacher).expect(403);
    await call('put', 'communications/sms-source', tokens.teacher).expect(403);
    await call('get', 'sms-bundles/catalog').expect(401);
  });

  it('refuses a missing, malformed or other school X-Tenant-ID', async () => {
    for (const tenant of [null, 'not-a-uuid', OTHER_TENANT_ID]) {
      const res = await call('get', 'sms-bundles/orders', tokens.admin, tenant);
      expect([400, 401, 403, 404], `tenant=${tenant}`).toContain(res.status);
    }
  });
});
