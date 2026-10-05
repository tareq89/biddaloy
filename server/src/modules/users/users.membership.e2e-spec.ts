import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import cookieParser = require('cookie-parser');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

/** [13.2.1] A teacher leaves a school; their next token refresh no longer lists it. */
describe('POST /users/me/leave (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const OTHER_TENANT = '00000000-0000-4000-8000-000000000391';
  const TEACHER_ID = '00000000-0000-4000-8000-000000000392';
  const EMAIL = 'leaver-1321@example.com';

  const request = () => supertest(app.getHttpServer());

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.use(cookieParser()); // refresh reads its token from the cookie
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Leave E2E Other School', 'leave-e2e-other', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_TENANT],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Leaving Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [TEACHER_ID, EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    for (const tenant of [SEED_TENANT_ID, OTHER_TENANT]) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [TEACHER_ID, tenant, UserRole.TEACHER],
      );
    }
  }, 60000);

  afterAll(async () => {
    // Best-effort: audit_logs is append-only, so the school and user may stay behind.
    await dataSource.query('DELETE FROM user_tenants WHERE user_id = $1', [TEACHER_ID]);
    await dataSource.query('DELETE FROM refresh_tokens WHERE user_id = $1', [TEACHER_ID]);
    await app.close();
  });

  it('leaving a school drops it from the next refreshed token, the other school stays', async () => {
    const login = await request()
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    expect(login.body.memberships.map((m: { tenantId: string }) => m.tenantId).sort()).toEqual(
      [SEED_TENANT_ID, OTHER_TENANT].sort(),
    );
    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('__Host-refresh_token='),
    )!;
    const refreshCookie = `__Host-refresh_token=${decodeURIComponent(cookie.split(';')[0].split('=')[1])}`;

    await request()
      .post('/api/v1/users/me/leave')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(204);

    const refreshed = await request()
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);
    expect(refreshed.body.memberships.map((m: { tenantId: string }) => m.tenantId)).toEqual([
      OTHER_TENANT,
    ]);
  });
});
