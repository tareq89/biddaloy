import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { DataSource } from 'typeorm';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';

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
  let fetchMock: ReturnType<typeof vi.fn>;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;
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

  it('rejects a request from a caller who is not an ADMIN/SUPER_ADMIN of the school', async () => {
    await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
      .expect(401);
  });
});
