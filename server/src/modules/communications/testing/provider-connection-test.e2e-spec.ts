import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * E2E coverage for POST /schools/:id/settings/test (#8.7.12) — proves the
 * whole pipeline end to end (auth guard, tenant-scope permission check,
 * DTO validation, the real provider call) rather than just the unit-level
 * pieces `connection-test.service.spec.ts` and each provider's own spec
 * already cover. Only WhatsApp is exercised here (a single stubbed
 * `fetch`, straightforward to intercept across the whole app's module
 * graph); the other 3 media's provider-level behavior is already covered
 * by their own unit specs.
 */
describe('Provider connection test E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let teacherToken: string;
  let tenantBAdminToken: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  const TENANT_ID = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000299';
  const TEACHER_USER_ID = '00000000-0000-4000-8000-000000000298';
  const TEACHER_EMAIL = 'teacher@provider-connection-test.example';
  const TENANT_B_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000297';
  const TENANT_B_ADMIN_EMAIL = 'admin-b@provider-connection-test.example';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    // A real TEACHER membership in TENANT_ID — authenticated, but not in
    // @Roles(SUPER_ADMIN, ADMIN), so RolesGuard (not just "no token at
    // all") is what should reject it.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ('${TEACHER_USER_ID}', '${TEACHER_EMAIL}', '${SEED_ADMIN_PASSWORD_HASH}', 'Connection Test Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${TEACHER_USER_ID}', '${TENANT_ID}', '${UserRole.TEACHER}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );

    // A second school, with a real ADMIN membership only there — for the
    // tenant-isolation case (an admin of one school testing another's
    // provider config).
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ('${TENANT_B}', 'Connection Test School B', 'connection-test-school-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ('${TENANT_B_ADMIN_USER_ID}', '${TENANT_B_ADMIN_EMAIL}', '${SEED_ADMIN_PASSWORD_HASH}', 'Connection Test Admin B', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${TENANT_B_ADMIN_USER_ID}', '${TENANT_B}', '${UserRole.ADMIN}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;

    const teacherLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: TEACHER_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    teacherToken = teacherLoginRes.body.access_token;

    const tenantBAdminLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: TENANT_B_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    tenantBAdminToken = tenantBAdminLoginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tests unsaved WhatsApp config without persisting it or leaking the token on failure', async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { code: 190, message: 'Invalid OAuth access token: super-secret-token-value' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        medium: 'WHATSAPP',
        config: { phoneNumberId: '99999', accessToken: 'super-secret-token-value' },
      })
      .expect(200);

    expect(res.body).toEqual({
      success: false,
      message: 'Authentication rejected — check the access token.',
    });
    expect(JSON.stringify(res.body)).not.toContain('super-secret-token-value');

    // Config was never saved — a plain settings read afterward shows
    // nothing new was persisted from the test call.
    const school = await dataSource.query('SELECT settings FROM schools WHERE id = $1', [
      TENANT_ID,
    ]);
    const settingsText = JSON.stringify(school[0]?.settings ?? {});
    expect(settingsText).not.toContain('super-secret-token-value');
    expect(settingsText).not.toContain('99999');
  });

  it('rejects an unauthenticated request', async () => {
    await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
      .expect(401);
  });

  // Distinct from the unauthenticated case above: a real, valid session
  // for a role RolesGuard doesn't allow on this route. context.guard.ts's
  // RolesGuard throws UnauthorizedException (401) for a disallowed role,
  // not ForbiddenException (403) — see that file's own comment — so this
  // pins the documented behavior rather than assuming 403.
  it('rejects an authenticated caller whose role is not ADMIN/SUPER_ADMIN', async () => {
    await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
      .expect(401);
  });

  it('rejects an admin of one school testing another school outside their membership', async () => {
    await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('Authorization', `Bearer ${tenantBAdminToken}`)
      .set('X-Tenant-ID', TENANT_B)
      .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
      .expect(403);
  });

  it('rejects a request with a missing or invalid X-Tenant-ID', async () => {
    await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('Authorization', `Bearer ${token}`)
      .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
      .expect(401);

    await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', '00000000-0000-4000-8000-000000000fff')
      .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
      .expect(401);
  });
});
