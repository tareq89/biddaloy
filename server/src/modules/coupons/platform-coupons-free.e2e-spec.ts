import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { authenticator } from 'otplib';
import { ApprovalScope, DEV_COCKPIT_TOTP_SECRET, UserStatus } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { User } from '../users/entities/user.entity';
import { PlatformAdmin } from '../platform-identity/entities/platform-admin.entity';
import { PlatformHomeService } from '../platform-identity/platform-home.service';
import { hashPassword } from '../auth/password-hash';
import { LoginAttemptService } from '../auth/login-attempt.service';
import { MfaService } from '../auth/mfa/mfa.service';
import { StepUpService } from '../auth/step-up.service';
import { AccountAccessDeliveryService } from '../account-access/account-access-delivery.service';

/**
 * [Epic 100 #3870] POST /platform/coupons/free is strict (D29): a step-up token AND the other
 * owner. One active owner means 403 SECOND_OWNER_REQUIRED, never a fallback to a lone owner. A
 * PATCH on a stored 100 percent coupon is held to the same bar. Real HTTP, guards, Postgres, Redis.
 * The tests share state and run in order.
 */
describe('Free coupons need the second owner (e2e)', () => {
  const COCKPIT = '/api/v1/auth/cockpit';
  const FREE = '/api/v1/platform/coupons/free';
  const PASSWORD = 'Owner-pass-12345';
  const totp = authenticator.clone({ digits: 6, step: 30, window: 1 });
  let app: INestApplication;
  let ds: DataSource;
  let redis: Redis;
  const sent: { kind: string; to: string; code?: string }[] = [];

  const http = () => supertest(app.getHttpServer());
  const codeSentTo = (to: string, kind: string) =>
    sent.filter((s) => s.to === to && s.kind === kind).at(-1)?.code as string;

  type Owner = { id: string; email: string; phone: string; token: string };

  async function makeOwner(): Promise<Owner> {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const email = `free-coupon-${suffix}@biddaloy.test`;
    const phone = `+88017${suffix.slice(-9).padStart(9, '0')}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email,
        phone,
        full_name: 'Free coupon e2e owner',
        status: UserStatus.ACTIVE,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
        phone_verified_at: new Date(),
      }),
    );
    await ds.getRepository(PlatformAdmin).insert({ user_id: user.id });
    await app.get(MfaService).enrolWithKnownSecret(user.id, DEV_COCKPIT_TOTP_SECRET);
    const login = await http()
      .post(`${COCKPIT}/login`)
      .send({ email, password: PASSWORD })
      .expect(200);
    const mfa = await http()
      .post(`${COCKPIT}/mfa`)
      .send({ mfaToken: login.body.mfaToken, code: totp.generate(DEV_COCKPIT_TOTP_SECRET) })
      .expect(200);
    const done = await http()
      .post(`${COCKPIT}/device-otp`)
      .send({
        deviceToken: mfa.body.deviceToken,
        smsCode: codeSentTo(phone, 'COCKPIT_DEVICE_CODE'),
        emailCode: codeSentTo(email, 'COCKPIT_DEVICE_CODE'),
      })
      .expect(200);
    return { id: user.id, email, phone, token: done.body.access_token };
  }

  /** Exactly these owners are active; every other owner row is locked (D24: SUSPENDED). */
  async function onlyActive(...ids: string[]) {
    await ds.query(
      `UPDATE users SET status = CASE WHEN id = ANY($1::uuid[]) THEN $2::users_status_enum ELSE $3::users_status_enum END
        WHERE id IN (SELECT user_id FROM platform_admins)`,
      [ids, UserStatus.ACTIVE, UserStatus.SUSPENDED],
    );
  }

  /**
   * A single-use step-up token. Minted by the service: the authenticator code is one-per-30 s
   * step, so a test needing many tokens cannot go through POST /platform/step-up each time (the
   * first test does, once).
   */
  const stepUp = async (owner: Owner, scope: ApprovalScope) =>
    (
      await app
        .get(StepUpService)
        .issueForPlatformAdmin(owner.id, scope, (await app.get(PlatformHomeService).id()) as string)
    ).approval_token;

  const as = (owner: Owner, req: supertest.Test) =>
    req.set('Authorization', `Bearer ${owner.token}`);

  // Fixed once: the grant is bound to a hash of the exact body, so a retry must send the same one.
  const CODE = `FREE${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
  const BODY = {
    code: CODE,
    starts_at: new Date(Date.now() - 86_400_000).toISOString(),
    ends_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  };

  const couponRows = async (code: string) =>
    (await ds.query(`SELECT id, percent, active FROM coupons WHERE code = $1`, [code])) as {
      id: string;
      percent: number;
      active: boolean;
    }[];

  let a: Owner;
  let b: Owner;
  let couponId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.COCKPIT_DOMAIN = process.env.COCKPIT_DOMAIN ?? 'cockpit.biddaloy.test';
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LoginAttemptService)
      .useValue(new LoginAttemptService(redis, 5, 15 * 60_000, 'e2e-free-coupon', false))
      .compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    await app.get(PlatformHomeService).ensure();
    await ds.query(`DELETE FROM platform_settings WHERE key = 'approvals.enabled'`);

    const delivery = app.get(AccountAccessDeliveryService);
    const real = delivery.deliver.bind(delivery);
    vi.spyOn(delivery, 'deliver').mockImplementation((input: any) => {
      sent.push({ kind: input.kind, to: input.to, code: input.vars?.code });
      return real(input);
    });
    a = await makeOwner();
    b = await makeOwner();
  }, 90000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
    redis.disconnect();
  });

  it('one active owner: 403 SECOND_OWNER_REQUIRED, nothing created', async () => {
    await onlyActive(a.id);
    // The real mint route, once: PLATFORM_COUPON_FREE must be an allowed step-up scope.
    const nextStep = authenticator
      .clone({ digits: 6, step: 30, window: 1, epoch: Date.now() + 30_000 })
      .generate(DEV_COCKPIT_TOTP_SECRET);
    const minted = await as(
      a,
      http().post('/api/v1/platform/step-up').send({
        scope: ApprovalScope.PLATFORM_COUPON_FREE,
        code: nextStep,
      }),
    ).expect(200);

    const res = await as(a, http().post(FREE))
      .set('X-Approval-Token', minted.body.approval_token)
      .set('Idempotency-Key', 'free-one-owner')
      .send(BODY)
      .expect(403);
    expect(res.body.details?.code).toBe('SECOND_OWNER_REQUIRED');
    expect(await couponRows(CODE)).toHaveLength(0);
  }, 60000);

  it('two owners: request, other owner approves, grant claimed once; a same-key retry makes no second coupon', async () => {
    await onlyActive(a.id, b.id);
    const send = async (approval?: string) => {
      const r = as(a, http().post(FREE))
        .set('X-Approval-Token', await stepUp(a, ApprovalScope.PLATFORM_COUPON_FREE))
        .set('Idempotency-Key', 'free-two-owners');
      return (approval ? r.set('X-Platform-Approval', approval) : r).send(BODY);
    };

    const asked = await send();
    expect(asked.status).toBe(403);
    expect(asked.body.details?.code).toBe('APPROVAL_REQUESTED');
    const requestId: string = asked.body.details.requestId;
    expect(await couponRows(CODE)).toHaveLength(0);

    // The requester cannot grant their own request.
    await as(a, http().post(`/api/v1/platform/approvals/${requestId}/approve`))
      .set('X-Approval-Token', await stepUp(a, ApprovalScope.PLATFORM_APPROVAL_DECIDE))
      .expect(409);
    await as(b, http().post(`/api/v1/platform/approvals/${requestId}/approve`))
      .set('X-Approval-Token', await stepUp(b, ApprovalScope.PLATFORM_APPROVAL_DECIDE))
      .expect(204);

    const created = await send(requestId);
    expect(created.status).toBe(201);
    expect(created.body.percent).toBe(100);
    const rows = await couponRows(CODE);
    expect(rows).toHaveLength(1);
    couponId = rows[0].id;

    // Same key and same grant again (a lost response, a double click). The guards run before the
    // idempotency interceptor, so the spent grant is refused first: no replay, and no second coupon.
    const retry = await send(requestId);
    expect(retry.status).toBe(403);
    expect(retry.body.details?.code).toBe('APPROVAL_INVALID');
    expect(await couponRows(CODE)).toHaveLength(1);
  }, 90000);

  it('PATCH on the 100 percent coupon needs the other owner; with one owner SECOND_OWNER_REQUIRED', async () => {
    // The suite clears tables between tests, so this test seeds its own stored 100 percent coupon.
    const [row] = await ds.query(
      `INSERT INTO coupons (code, discount_kind, percent, scope, per_school_max, starts_at, ends_at, created_by_user_id)
       VALUES ($1, 'PERCENT', 100, 'ALL', 1, now() - interval '1 day', now() + interval '30 days', $2)
       RETURNING id`,
      [`PATCH${CODE}`.slice(0, 20), a.id],
    );
    couponId = row.id;
    const patch = async (approval?: string) => {
      const r = as(a, http().patch(`/api/v1/platform/coupons/${couponId}`)).set(
        'X-Approval-Token',
        await stepUp(a, ApprovalScope.PLATFORM_COUPON),
      );
      return (approval ? r.set('X-Platform-Approval', approval) : r).send({ active: false });
    };

    const asked = await patch();
    expect(asked.status).toBe(403);
    expect(asked.body.details?.code).toBe('APPROVAL_REQUESTED');
    expect((await couponRows(`PATCH${CODE}`.slice(0, 20)))[0].active).toBe(true);
    const requestId: string = asked.body.details.requestId;
    await as(b, http().post(`/api/v1/platform/approvals/${requestId}/approve`))
      .set('X-Approval-Token', await stepUp(b, ApprovalScope.PLATFORM_APPROVAL_DECIDE))
      .expect(204);
    expect((await patch(requestId)).status).toBe(200);
    expect((await couponRows(`PATCH${CODE}`.slice(0, 20)))[0].active).toBe(false);

    await onlyActive(a.id);
    const alone = await patch();
    expect(alone.status).toBe(403);
    expect(alone.body.details?.code).toBe('SECOND_OWNER_REQUIRED');
  }, 90000);
});
