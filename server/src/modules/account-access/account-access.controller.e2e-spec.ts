import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import cookieParser = require('cookie-parser');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { AuthService } from '../auth/auth.service';
import { AuthTokenService, INVITE_TTL_MS } from './auth-token.service';
import { SEED_TENANT_ID } from '@test/constants';
import { AuthTokenPurpose } from '@biddaloy/shared';

function extractRefreshCookie(res: supertest.Response): string {
  const headers = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const header = headers.find((c) => c.startsWith('__Host-refresh_token='));
  if (!header) throw new Error('No refresh_token cookie was set on this response');
  const match = header.match(/^__Host-refresh_token=([^;]+)/);
  return decodeURIComponent(match![1]);
}

describe('AccountAccessController (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authTokens: AuthTokenService;

  const USER_ID = '00000000-0000-4000-8000-0000000004a1';
  const USER_EMAIL = 'activate-e2e@testschool.com';

  const PHONE_USER_ID = '00000000-0000-4000-8000-0000000004a2';
  const PHONE_NUMBER = '01799990000';

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    // D6: makes forgot-password echo the real OTP/token back in the
    // response, so this e2e spec can complete the recovery flow without
    // scraping a delivery provider's logs.
    process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    moduleFixture.get(AuthService);

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    app.use(cookieParser());
    await app.init();

    dataSource = app.get(DataSource);
    authTokens = app.get(AuthTokenService);

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status)
       VALUES ($1, $2, NULL, 'Activation Invitee', 'INACTIVE')
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email, password_hash = NULL, status = 'INACTIVE'`,
      [USER_ID, USER_EMAIL],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'TEACHER')
       ON CONFLICT DO NOTHING`,
      [USER_ID, SEED_TENANT_ID],
    );

    // Phone-only guardian for the "recover with only a phone" AC — no
    // email on file at all, so success here proves the SMS/OTP branch
    // works end to end, not the email/link one.
    await dataSource.query(
      `INSERT INTO users (id, phone, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'Phone-only Guardian', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE
         SET phone = EXCLUDED.phone, password_hash = EXCLUDED.password_hash, status = 'ACTIVE'`,
      [PHONE_USER_ID, PHONE_NUMBER, '$2b$10$rGV9zEDpgnc/spXBlHqA9O5IjpBvndIyZE78fIhV8ZV4.5GAUfPJ.'],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'PARENT')
       ON CONFLICT DO NOTHING`,
      [PHONE_USER_ID, SEED_TENANT_ID],
    );
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [USER_ID]);
    await dataSource.query(`DELETE FROM auth_tokens WHERE user_id = $1`, [USER_ID]);
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [USER_ID]);
    await dataSource.query(
      `UPDATE users SET password_hash = NULL, email = NULL, status = 'INACTIVE' WHERE id = $1`,
      [USER_ID],
    );
    await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [PHONE_USER_ID]);
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [PHONE_USER_ID]);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [PHONE_USER_ID]);
    await app.close();
  });

  it('full flow: verify -> activate -> refresh with the new cookie works', async () => {
    const { raw } = await authTokens.issue({
      userId: USER_ID,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs: INVITE_TTL_MS,
    });

    const verifyRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/activate/verify')
      .send({ token: raw })
      .expect(200);
    expect(verifyRes.body).toEqual({
      status: 'valid',
      full_name: 'Activation Invitee',
      school_name: expect.any(String),
    });
    expect(verifyRes.body.email).toBeUndefined();
    expect(verifyRes.body.phone).toBeUndefined();

    const activateRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/activate')
      .send({ token: raw, password: 'a-strong-new-password' })
      .expect(200);
    expect(activateRes.body.access_token).toBeDefined();
    const refreshCookie = extractRefreshCookie(activateRes);

    const refreshRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `__Host-refresh_token=${refreshCookie}`)
      .expect(200);
    expect(refreshRes.body.access_token).toBeDefined();
  });

  it('a used token cannot activate a second time', async () => {
    const { raw } = await authTokens.issue({
      userId: USER_ID,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs: INVITE_TTL_MS,
    });
    await supertest(app.getHttpServer())
      .post('/api/v1/auth/activate')
      .send({ token: raw, password: 'a-strong-new-password' })
      .expect(200);

    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/activate')
      .send({ token: raw, password: 'another-strong-password' })
      .expect(400);
    expect(res.body.message).toBe('consumed');
  });

  it('resend always returns 202, even for an unknown identifier', async () => {
    await supertest(app.getHttpServer())
      .post('/api/v1/auth/activate/resend')
      .send({ identifier: 'no-such-account@testschool.com' })
      .expect(202);
  });

  describe('forgot-password / reset-password', () => {
    // The issue's headline AC: a guardian who only has a phone on file
    // must be able to recover, end to end, with no email step at all.
    it('recovers with only a phone: forgot -> otp -> reset -> login with the new password', async () => {
      const forgotRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: PHONE_NUMBER })
        .expect(202);
      const otp = forgotRes.body.debug?.otp;
      expect(otp).toMatch(/^\d{6}$/);

      await supertest(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ new_password: 'a-brand-new-password', phone: PHONE_NUMBER, otp })
        .expect(200);

      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ phone: PHONE_NUMBER, password: 'a-brand-new-password' })
        .expect(200);
    });

    // D6's echo flag is ON for this whole spec (the recovery-flow test above
    // needs it), which necessarily makes `debug` differ between a known and
    // an unknown identifier — that field is exactly what the flag exists to
    // add for test observability. What must NOT differ, with or without the
    // flag, is the status code and every other field.
    it('gives an identical status and non-debug body for a known and an unknown identifier', async () => {
      const known = await supertest(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: USER_EMAIL })
        .expect(202);
      const unknown = await supertest(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: 'definitely-not-a-real-account@testschool.com' })
        .expect(202);

      expect(known.status).toBe(unknown.status);
      const { debug: _knownDebug, ...knownRest } = known.body;
      const { debug: _unknownDebug, ...unknownRest } = unknown.body;
      expect(knownRest).toEqual(unknownRest);
    });
  });
});
