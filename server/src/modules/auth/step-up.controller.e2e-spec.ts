import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { STEP_UP_REDIS } from './step-up.service';
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
  // A third ADMIN for the scope-mismatch test, for the same cooldown reason.
  const APPROVER3_ID = '00000000-0000-4000-8000-0000000005b3';
  const APPROVER3_EMAIL = 'step-up-approver3@testschool.com';

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
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status)
       VALUES ($1, $2, NULL, 'Step-up Approver 3', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, status = 'ACTIVE'`,
      [APPROVER3_ID, APPROVER3_EMAIL],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'ADMIN')
       ON CONFLICT DO NOTHING`,
      [APPROVER3_ID, SEED_TENANT_ID],
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
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [APPROVER3_ID]);
    await dataSource.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [APPROVER3_ID]);
    await app.close();
  });

  // The per-actor guess limit (5 per window) is shared by every verify in this file;
  // without a reset the sixth verify by ACTOR_ID gets a 429 instead of the case under test.
  beforeEach(async () => {
    const redis = app.get<Redis>(STEP_UP_REDIS);
    const stale = await redis.keys(`step-up-attempts:*${ACTOR_ID}*`);
    await redis.del(`step-up-attempts:actor:${ACTOR_ID}`, ...stale);
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
    ).send({ identifier: ACTOR_EMAIL, scope: 'fees.discount' });
    expect(known.status).toBe(202);
    expect(known.body).toEqual({});

    const unknown = await authed(
      supertest(app.getHttpServer()).post('/api/v1/auth/step-up/otp/request'),
    ).send({ identifier: 'nobody-at-all@testschool.com', scope: 'fees.discount' });
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual({});
  });

  it('full OTP flow: request -> verify -> a 300s-scoped approval token, actor != approver', async () => {
    const requestRes = await authed(
      supertest(app.getHttpServer()).post('/api/v1/auth/step-up/otp/request'),
    ).send({ identifier: SEED_ADMIN_EMAIL, scope: 'fees.duplicate_override' });
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
    ).send({ identifier: ACTOR_EMAIL, scope: 'payments.reverse' });
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
      scope: 'fees.discount',
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

  // [F-132] The request body must name the scope the code is for.
  it('otp/request without a scope, or with an unknown one, is 400 before any identifier lookup', async () => {
    const missing = await authed(
      supertest(app.getHttpServer()).post('/api/v1/auth/step-up/otp/request'),
    ).send({ identifier: 'nobody-at-all@testschool.com' });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toEqual(
      expect.arrayContaining([expect.stringMatching(/^scope /)]),
    );

    const unknown = await authed(
      supertest(app.getHttpServer()).post('/api/v1/auth/step-up/otp/request'),
    ).send({ identifier: 'nobody-at-all@testschool.com', scope: 'nope' });
    expect(unknown.status).toBe(400);
    expect(JSON.stringify(unknown.body)).not.toContain('nobody-at-all');
  });

  // [F-132] A code is bound to the scope it was requested for. Verifying it
  // under another scope is the same 401 as a wrong code, and the body carries
  // none of the identifier, the code or the scope (Rule 23).
  it('a code requested for one scope verified under another is 401 Invalid credentials and echoes nothing back', async () => {
    const requestRes = await authed(
      supertest(app.getHttpServer()).post('/api/v1/auth/step-up/otp/request'),
    ).send({ identifier: APPROVER3_EMAIL, scope: 'fees.discount' });
    expect(requestRes.status).toBe(202);
    const otp = requestRes.body.debug?.otp;
    expect(otp).toMatch(/^\d{6}$/);

    const res = await authed(supertest(app.getHttpServer()).post('/api/v1/auth/step-up')).send({
      identifier: APPROVER3_EMAIL,
      method: 'OTP',
      otp,
      scope: 'payments.reverse',
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(APPROVER3_EMAIL);
    expect(body).not.toContain(otp);
    expect(body).not.toContain('payments.reverse');
    expect(body).not.toContain('fees.discount');
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

  it('PASSWORD is accepted once the school saves fees.approvalMode = OTP_OR_PASSWORD (F-013)', async () => {
    const adminLogin = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const patchMode = (approvalMode: string) =>
      supertest(app.getHttpServer())
        .patch(`/api/v1/schools/${SEED_TENANT_ID}/settings`)
        .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .send({
          version: 1,
          fees: {
            approvalMode,
            notifyOnManualGenerationDefault: false,
            notifyOnScheduleDefault: true,
            fineDueDays: 7,
          },
        });

    try {
      const patched = await patchMode('OTP_OR_PASSWORD');
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const res = await authed(supertest(app.getHttpServer()).post('/api/v1/auth/step-up')).send({
        identifier: SEED_ADMIN_EMAIL,
        method: 'PASSWORD',
        password: SEED_ADMIN_PASSWORD,
        scope: 'discount_rules.manage',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.approval_token).toEqual(expect.any(String));
    } finally {
      const reset = await patchMode('OTP');
      expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    }
  });

  it('rejects a missing/invalid X-Tenant-ID with 401', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/step-up/otp/request')
      .set('Authorization', `Bearer ${actorToken}`)
      .send({ identifier: SEED_ADMIN_EMAIL, scope: 'fees.discount' });

    expect(res.status).toBe(401);
  });

  it.each(['PARENT', 'STUDENT'])('%s gets 403 on both step-up routes', async (role) => {
    const id =
      role === 'PARENT'
        ? '00000000-0000-4000-8000-0000000005d1'
        : '00000000-0000-4000-8000-0000000005d2';
    const email = `step-up-${role.toLowerCase()}@testschool.com`;
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'Step-up Denied', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, status = 'ACTIVE'`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [id, SEED_TENANT_ID, role],
    );
    try {
      const login = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const as = (req: supertest.Test) =>
        req
          .set('Authorization', `Bearer ${login.body.access_token}`)
          .set('X-Tenant-ID', SEED_TENANT_ID);

      const otp = await as(
        supertest(app.getHttpServer()).post('/api/v1/auth/step-up/otp/request'),
      ).send({ identifier: SEED_ADMIN_EMAIL, scope: 'fees.discount' });
      expect(otp.status).toBe(403);
      const verify = await as(supertest(app.getHttpServer()).post('/api/v1/auth/step-up')).send({
        identifier: SEED_ADMIN_EMAIL,
        method: 'OTP',
        otp: '000000',
        scope: 'fees.discount',
      });
      expect(verify.status).toBe(403);
    } finally {
      await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);
      await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [id]);
      await dataSource.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [id]);
    }
  });

  it("a different caller is unaffected by another caller's wrong OTPs for the same approver", async () => {
    const identifier = 'step-up-cross-caller@testschool.com';
    const redis = app.get<Redis>(STEP_UP_REDIS);
    // Every key a guess here counts against, so a rerun on the same Redis starts clean (not 429).
    const keys = [
      `step-up-attempts:actor:${ACTOR_ID}`,
      `step-up-attempts:actor:${SEED_ADMIN_USER_ID}`,
      `step-up-attempts:pair:${SEED_TENANT_ID}:${ACTOR_ID}:${identifier}`,
      `step-up-attempts:pair:${SEED_TENANT_ID}:${SEED_ADMIN_USER_ID}:${identifier}`,
      `step-up-attempts:approver:${SEED_TENANT_ID}:${identifier}`,
    ];
    await redis.del(...keys);

    for (let i = 0; i < 5; i++) {
      const res = await authed(supertest(app.getHttpServer()).post('/api/v1/auth/step-up')).send({
        identifier,
        method: 'OTP',
        otp: '000000',
        scope: 'fees.discount',
      });
      expect(res.status).toBe(401);
    }
    const adminLogin = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const other = await supertest(app.getHttpServer())
      .post('/api/v1/auth/step-up')
      .set('Authorization', `Bearer ${adminLogin.body.access_token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ identifier, method: 'OTP', otp: '000000', scope: 'fees.discount' });
    expect(other.status).toBe(401);

    await redis.del(...keys);
  });

  it('5 wrong OTPs from another school do not lock the same approver out of step-up in their own school', async () => {
    // The approver belongs to school B only. The attacker is ACTOR, signed in
    // to the seed school (A), guessing that approver's identifier.
    const TENANT_B = '00000000-0000-4000-8000-0000000005c1';
    const APPROVER_B_ID = '00000000-0000-4000-8000-0000000005c2';
    const APPROVER_B_EMAIL = 'step-up-approver-b@testschool.com';
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Step-up School B', 'step-up-tenant-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'Step-up Approver B', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, status = 'ACTIVE'`,
      [APPROVER_B_ID, APPROVER_B_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'ADMIN')
       ON CONFLICT DO NOTHING`,
      [APPROVER_B_ID, TENANT_B],
    );

    // Earlier tests in this file already spent part of ACTOR's step-up
    // budget (5 per 15 minutes by default). Start from a clean count so the
    // 5 guesses below all reach the OTP check instead of the rate limit.
    await app
      .get<Redis>(STEP_UP_REDIS)
      .del(
        `step-up-attempts:actor:${ACTOR_ID}`,
        `step-up-attempts:pair:${SEED_TENANT_ID}:${ACTOR_ID}:${APPROVER_B_EMAIL}`,
      );

    try {
      for (let i = 0; i < 5; i++) {
        const res = await authed(supertest(app.getHttpServer()).post('/api/v1/auth/step-up')).send({
          identifier: APPROVER_B_EMAIL,
          method: 'OTP',
          otp: '000000',
          scope: 'fees.discount',
        });
        expect(res.status).toBe(401);
      }

      const login = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: APPROVER_B_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const inB = (req: supertest.Test) =>
        req.set('Authorization', `Bearer ${login.body.access_token}`).set('X-Tenant-ID', TENANT_B);

      const requestRes = await inB(
        supertest(app.getHttpServer()).post('/api/v1/auth/step-up/otp/request'),
      ).send({ identifier: APPROVER_B_EMAIL, scope: 'fees.discount' });
      const otp = requestRes.body.debug?.otp;
      expect(otp).toMatch(/^\d{6}$/);

      const verifyRes = await inB(supertest(app.getHttpServer()).post('/api/v1/auth/step-up')).send(
        { identifier: APPROVER_B_EMAIL, method: 'OTP', otp, scope: 'fees.discount' },
      );
      expect(verifyRes.status).toBe(200);
    } finally {
      await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [APPROVER_B_ID]);
      await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [APPROVER_B_ID]);
      await dataSource.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [APPROVER_B_ID]);
    }
  });
});
