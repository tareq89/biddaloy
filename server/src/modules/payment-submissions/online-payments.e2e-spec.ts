import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_TENANT_ID,
} from '@test/constants';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { createProofFixture } from '@test/helpers/proof-submissions.fixture';
import { AppModule } from '../../app.module';
import { BkashClient } from '../payment-gateways/bkash/bkash.client';
import { TENANT_SETTINGS_SCHEMA_VERSION } from '../schools/dto/tenant-settings.dto';
import { buildValidationPipeOptions } from '../../validation-pipe';

const URL = '/api/v1/portal/online-payments';
const TEST_URL = '/api/v1/settings/payments/bkash/test';
const UUID = '00000000-0000-4000-8000-0000000fffff';

/** No live bKash: the token test passes, so the school can switch online payments on. */
class MockBkash {
  isConfigured() {
    return false;
  }
  async testConnection() {}
}

/** [3.x/#3984] Online payment routes over HTTP: tenant header, roles, family scope, ids. */
describe('Online payments (E2E)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let fix: Awaited<ReturnType<typeof createProofFixture>>;
  let accountantToken: string;

  const call = (
    m: 'get' | 'post',
    url: string,
    token: string,
    tenant: string | null = SEED_TENANT_ID,
  ) => {
    const r = supertest(app.getHttpServer())[m](url).set('Authorization', `Bearer ${token}`);
    return tenant === null ? r : r.set('X-Tenant-ID', tenant);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BkashClient)
      .useClass(MockBkash)
      .compile();
    app = mod.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    fix = await createProofFixture(app, ds);
    // An ACCOUNTANT: has no SETTINGS_MANAGE.
    const email = `online-acct-${randomUUID().slice(0, 8)}@e2e.example`;
    const [u] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1,$2,'Acct','ACTIVE',NOW(),NOW()) RETURNING id`,
      [email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [u.id, SEED_TENANT_ID, UserRole.ACCOUNTANT],
    );
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    accountantToken = res.body.access_token;
  }, 120000);
  afterAll(async () => {
    await fix?.cleanup();
    await app?.close();
  });
  beforeEach(() => fix.reset());

  it('missing X-Tenant-ID is 401 and an invalid one is refused, on every route', async () => {
    const routes: ['get' | 'post', string][] = [
      ['post', URL],
      ['get', `${URL}/${UUID}`],
      ['post', TEST_URL],
    ];
    for (const [m, url] of routes) {
      await call(m, url, fix.parent.token, null).expect(401);
      await call(m, url, fix.parent.token, UUID).expect((r) =>
        expect([401, 403, 404]).toContain(r.status),
      );
    }
  });

  it('a STUDENT cannot start or read an online payment (403)', async () => {
    await call('post', URL, fix.student.token)
      .send({ billIds: [UUID] })
      .expect(403);
    await call('get', `${URL}/${UUID}`, fix.student.token).expect(403);
  });

  it('another family bill is 404 (online enabled, gateway available)', async () => {
    const [{ settings: before }] = await ds.query(`SELECT settings FROM schools WHERE id=$1`, [
      SEED_TENANT_ID,
    ]);
    const admin = (
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;
    const patch = (payments: object) =>
      supertest(app.getHttpServer())
        .patch(`/api/v1/schools/${SEED_TENANT_ID}/settings`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({ version: TENANT_SETTINGS_SCHEMA_VERSION, payments });
    try {
      // Save creds, pass the connection test (mocked), then switch online payments on.
      await patch({
        bkash: {
          environment: 'SANDBOX',
          appKey: 'k',
          appSecret: 's',
          username: 'u',
          password: 'p',
        },
      }).expect(200);
      await call('post', TEST_URL, admin).expect(200);
      await patch({ onlineEnabled: true }).expect(200);

      const theirs = await fix.bill(fix.fx.studentB, 200);
      const res = await call('post', URL, fix.parent.token).send({ billIds: [theirs] });
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain(theirs);
    } finally {
      await ds.query(`UPDATE schools SET settings = $2::jsonb WHERE id = $1`, [
        SEED_TENANT_ID,
        JSON.stringify(before ?? {}),
      ]);
    }
  });

  it('non-UUID id is 400; non-UUID billIds is 400', async () => {
    await call('get', `${URL}/nope`, fix.parent.token).expect(400);
    await call('post', URL, fix.parent.token)
      .send({ billIds: ['nope'] })
      .expect(400);
  });

  it('an unknown payment id is 404 for a guardian', async () => {
    await call('get', `${URL}/${UUID}`, fix.parent.token).expect(404);
  });

  it('test-connection by an ACCOUNTANT without settings permission is 403', async () => {
    await call('post', TEST_URL, accountantToken).expect(403);
  });

  it('callback: no params is 400, an unknown paymentID is a redirect that never echoes it', async () => {
    await supertest(app.getHttpServer()).get('/api/v1/online-payments/callback').expect(400);
    const res = await supertest(app.getHttpServer())
      .get('/api/v1/online-payments/callback?paymentID=UNKNOWN1&status=success')
      .expect(302);
    expect(res.headers.location).not.toContain('UNKNOWN1');
  });
});
