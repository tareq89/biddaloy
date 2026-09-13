import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
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
 * E2E for `POST /auth/step-up/otp/request` + `POST /auth/step-up` (16.2.2).
 */
describe('StepUpController (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let actorToken: string;

  const ACTOR_ID = '00000000-0000-4000-8000-0000000005b1';
  const ACTOR_EMAIL = 'step-up-actor@testschool.com';
  const ACTOR_PASSWORD_HASH = SEED_ADMIN_PASSWORD_HASH; // same plaintext, SEED_ADMIN_PASSWORD

  // A second ADMIN, distinct from SEED_ADMIN, used only by the wrong-OTP
  // test below — OtpService's 60s per-identifier cooldown means every test
  // that actually sends a code needs its own identifier, not a shared one.
  const APPROVER2_ID = '00000000-0000-4000-8000-0000000005b2';
  const APPROVER2_EMAIL = 'step-up-approver2@testschool.com';

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    // A second staff member (ACCOUNTANT) who will act as the "actor"
    // requesting step-up on the seeded ADMIN — keeps actor and approver
    // distinct, exercising the ordinary (not self-approval) path.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'Step-up Actor', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, status = 'ACTIVE'`,
      [ACTOR_ID, ACTOR_EMAIL, ACTOR_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'ACCOUNTANT')
       ON CONFLICT DO NOTHING`,
      [ACTOR_ID, SEED_TENANT_ID],
    );

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status)
       VALUES ($1, $2, NULL, 'Step-up Approver 2', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, status = 'ACTIVE'`,
      [APPROVER2_ID, APPROVER2_EMAIL],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'ADMIN')
       ON CONFLICT DO NOTHING`,
      [APPROVER2_ID, SEED_TENANT_ID],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ACTOR_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    actorToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [ACTOR_ID]);
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [ACTOR_ID]);
    await dataSource.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [ACTOR_ID]);
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [APPROVER2_ID]);
    await dataSource.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [APPROVER2_ID]);
    await app.close();
  });

  function authed(req: supertest.Test) {
    return req.set('Authorization', `Bearer ${actorToken}`).set('X-Tenant-ID', SEED_TENANT_ID);
  }

  it('otp/request never reveals whether the identifier resolves — 202 for both a real (but not-yet-eligible) user and an unknown one', async () => {
    // ACTOR is still ACCOUNTANT at this point (no FEE_APPROVE) — a real
    // user, but not an eligible approver. Deliberately not SEED_ADMIN_EMAIL
    // here: OtpService's 60s cooldown is per-identifier, and other tests
    // below need to actually send SEED_ADMIN_EMAIL a code.
    const known = await authed(
      supertest(app.getHttpServer()).post('/api/v1/auth/step-up/otp/request'),
    ).send({ identifier: ACTOR_EMAIL });
    expect(known.status).toBe(202);
    expect(known.body).toEqual({});

    const unknown = await authed(
      supertest(app.getHttpServer()).post('/api/v1/auth/step-up/otp/request'),
    ).send({ identifier: 'nobody-at-all@testschool.com' });
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual({});
  });

  it('full OTP flow: request -> verify -> a 300s-scoped approval token, actor != approver', async () => {
    const requestRes = await authed(
      supertest(app.getHttpServer()).post('/api/v1/auth/step-up/otp/request'),
    ).send({ identifier: SEED_ADMIN_EMAIL });
    expect(requestRes.status).toBe(202);
    const otp = requestRes.body.debug?.otp;
    expect(otp).toMatch(/^\d{6}$/);

    const verifyRes = await authed(
      supertest(app.getHttpServer()).post('/api/v1/auth/step-up'),
    ).send({
      identifier: SEED_ADMIN_EMAIL,
      method: 'OTP',
      otp,
      scope: 'fees.duplicate_override',
    });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.approval_token).toEqual(expect.any(String));
    expect(verifyRes.body.expires_at).toEqual(expect.any(String));
    expect(verifyRes.body.approver).toEqual({
      id: SEED_ADMIN_USER_ID,
      full_name: expect.any(String),
    });

    const secondsUntilExpiry = (new Date(verifyRes.body.expires_at).getTime() - Date.now()) / 1000;
    expect(secondsUntilExpiry).toBeGreaterThan(0);
    expect(secondsUntilExpiry).toBeLessThanOrEqual(300);
  });

  it('the actor may verify themselves as the approver (D9)', async () => {
    // Grant ACTOR the same FEE_APPROVE-eligible role the test shim checks.
    await dataSource.query(`UPDATE user_tenants SET role = 'ADMIN' WHERE user_id = $1`, [ACTOR_ID]);

    const requestRes = await authed(
      supertest(app.getHttpServer()).post('/api/v1/auth/step-up/otp/request'),
    ).send({ identifier: ACTOR_EMAIL });
    const otp = requestRes.body.debug?.otp;
    expect(otp).toMatch(/^\d{6}$/);

    const verifyRes = await authed(
      supertest(app.getHttpServer()).post('/api/v1/auth/step-up'),
    ).send({
      identifier: ACTOR_EMAIL,
      method: 'OTP',
      otp,
      scope: 'payments.reverse',
    });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.approver.id).toBe(ACTOR_ID);

    await dataSource.query(`UPDATE user_tenants SET role = 'ACCOUNTANT' WHERE user_id = $1`, [
      ACTOR_ID,
    ]);
  });

  it('a wrong OTP is rejected with 401 and never echoes the identifier or code back', async () => {
    await authed(supertest(app.getHttpServer()).post('/api/v1/auth/step-up/otp/request')).send({
      identifier: APPROVER2_EMAIL,
    });

    const res = await authed(supertest(app.getHttpServer()).post('/api/v1/auth/step-up')).send({
      identifier: APPROVER2_EMAIL,
      method: 'OTP',
      otp: '000000',
      scope: 'fees.discount',
    });

    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(APPROVER2_EMAIL);
  });

  it('PASSWORD is rejected with 400 PASSWORD_NOT_ALLOWED by default (approval_mode is OTP-only)', async () => {
    const res = await authed(supertest(app.getHttpServer()).post('/api/v1/auth/step-up')).send({
      identifier: SEED_ADMIN_EMAIL,
      method: 'PASSWORD',
      password: SEED_ADMIN_PASSWORD,
      scope: 'discount_rules.manage',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('PASSWORD_NOT_ALLOWED');
  });

  it('rejects a missing/invalid X-Tenant-ID with 401', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/step-up/otp/request')
      .set('Authorization', `Bearer ${actorToken}`)
      .send({ identifier: SEED_ADMIN_EMAIL });

    expect(res.status).toBe(401);
  });
});
