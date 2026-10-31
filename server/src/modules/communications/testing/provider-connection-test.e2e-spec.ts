import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../../app.module';
import { fetchPinnedJson } from '../providers/shared/pinned-http';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { DataSource } from 'typeorm';
import { TENANT_SETTINGS_SCHEMA_VERSION, UserRole } from '@biddaloy/shared';
import { TenantSettingsCache } from '../../schools/settings/tenant-settings-cache.service';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

// OneCodeSoft calls go through the SSRF guard + pinned undici client (not global fetch). Stub both so
// the SMS case needs no DNS or network; every other export of the guard module stays real.
vi.mock('../providers/shared/pinned-http', () => ({ fetchPinnedJson: vi.fn() }));
vi.mock('../providers/shared/outbound-destination-guard', async (importActual) => ({
  ...(await importActual<typeof import('../providers/shared/outbound-destination-guard')>()),
  assertSafeHttpDestination: vi.fn(async (rawUrl: string) => ({
    url: new URL(rawUrl),
    addresses: [{ address: '203.0.113.5', family: 4 }],
  })),
}));

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

  it('tests unsaved OneCodeSoft SMS config: connected on success, a fixed sentence on a bad key', async () => {
    const test = (apiKey: string) =>
      supertest(app.getHttpServer())
        .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          medium: 'SMS',
          config: {
            provider: 'onecodesoft',
            onecodesoft: { apiKey, apiUrl: 'https://sms.example.com/api' },
          },
        })
        .expect(200);

    vi.mocked(fetchPinnedJson).mockResolvedValueOnce({ status: 'success', data: { balance: 250 } });
    const ok = await test('good-key-value');
    // No balance amount: with no school block this could be the platform's own account.
    expect(ok.body).toEqual({ success: true, message: 'Connected to OneCodeSoft.' });

    vi.mocked(fetchPinnedJson).mockResolvedValueOnce({ message: 'Unauthenticated.' });
    const bad = await test('bad-key-value');
    // A refused key is named as such (not "could not reach"), in a fixed sentence (Rule 23).
    expect(bad.body).toEqual({
      success: false,
      message: 'OneCodeSoft rejected the API key — check it and try again.',
    });
    expect(JSON.stringify(bad.body)).not.toContain('bad-key-value');
  });

  // PR #3325 review round 2, finding 1: the settings form sends the saved apiUrl back with the
  // secret left out. The same apiUrl uses the stored key; a different one never gets it.
  it('tests a saved OneCodeSoft config when the override repeats the stored apiUrl', async () => {
    const apiUrl = 'https://sms.example.com/api';
    const http = supertest(app.getHttpServer());
    await http
      .patch(`/api/v1/schools/${TENANT_ID}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: {
          sms: { provider: 'onecodesoft', onecodesoft: { apiKey: 'stored-key-value', apiUrl } },
        },
      })
      .expect(200);
    const test = (url: string) =>
      http
        .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ medium: 'SMS', config: { provider: 'onecodesoft', onecodesoft: { apiUrl: url } } })
        .expect(200);
    try {
      vi.mocked(fetchPinnedJson).mockClear();
      vi.mocked(fetchPinnedJson).mockResolvedValueOnce({ status: 'success', data: { balance: 9 } });
      const same = await test(apiUrl);
      expect(same.body.success).toBe(true);
      // The stored (decrypted) key went to the stored host.
      const [, calledUrl, init] = vi.mocked(fetchPinnedJson).mock.calls[0];
      expect(String(calledUrl)).toContain('sms.example.com');
      expect(JSON.stringify(init)).toContain('stored-key-value');

      vi.mocked(fetchPinnedJson).mockClear();
      const other = await test('https://other.example.com/api');
      expect(other.body.success).toBe(false);
      expect(other.body.message).toMatch(/Testing a new destination requires/);
      expect(JSON.stringify(other.body)).not.toContain('stored-key-value');
      expect(vi.mocked(fetchPinnedJson)).not.toHaveBeenCalled();
    } finally {
      await dataSource.query(`UPDATE schools SET settings = NULL WHERE id = $1`, [TENANT_ID]);
      app.get(TenantSettingsCache).invalidate(TENANT_ID);
    }
  });

  it('returns the fixed test-site message when the message sink is on', async () => {
    process.env.MESSAGE_SINK = 'mailpit';
    try {
      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
        .expect(200);
      expect(res.body).toEqual({
        success: true,
        message: 'Test site: messages go to the test inbox',
      });
    } finally {
      delete process.env.MESSAGE_SINK;
    }
  });

  it('rejects an unauthenticated request', async () => {
    await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
      .expect(401);
  });

  // Distinct from the unauthenticated case above: a real, valid session
  // for a role without SETTINGS_MANAGE. PermissionsGuard answers 403.
  it('rejects an authenticated caller whose role lacks SETTINGS_MANAGE', async () => {
    await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
      .expect(403);
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
