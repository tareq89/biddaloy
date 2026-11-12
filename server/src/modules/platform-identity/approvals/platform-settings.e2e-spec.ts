import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { authenticator } from 'otplib';
import { ApprovalScope, DEV_COCKPIT_TOTP_SECRET, UserStatus } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { User } from '../../users/entities/user.entity';
import { PlatformAdmin } from '../entities/platform-admin.entity';
import { PlatformHomeService } from '../platform-home.service';
import { hashPassword } from '../../auth/password-hash';
import { LoginAttemptService } from '../../auth/login-attempt.service';
import { MfaService } from '../../auth/mfa/mfa.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';

/**
 * Route-level proof of the guard order on PATCH /platform/settings/approvals:
 * ApprovalGuard (step-up token) runs first, then the handler's two-person check, and the
 * setting changes only when both pass. Real HTTP, real guards.
 */
describe('Platform approvals switch (e2e)', () => {
  const COCKPIT = '/api/v1/auth/cockpit';
  const URL = '/api/v1/platform/settings/approvals';
  const PASSWORD = 'Owner-pass-12345';
  const totp = authenticator.clone({ digits: 6, step: 30, window: 1 });
  let app: INestApplication;
  let ds: DataSource;
  let redis: Redis;
  const sent: { kind: string; to: string; code?: string }[] = [];

  const http = () => supertest(app.getHttpServer());
  const codeSentTo = (to: string, kind: string) =>
    sent.filter((s) => s.to === to && s.kind === kind).at(-1)?.code as string;

  async function makeOwner() {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const email = `platform-switch-${suffix}@biddaloy.test`;
    const phone = `+88017${suffix.slice(-9).padStart(9, '0')}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email,
        phone,
        full_name: 'Switch e2e owner',
        status: UserStatus.ACTIVE,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
        phone_verified_at: new Date(),
      }),
    );
    await ds.getRepository(PlatformAdmin).insert({ user_id: user.id });
    await app.get(MfaService).enrolWithKnownSecret(user.id, DEV_COCKPIT_TOTP_SECRET);
    return { id: user.id, email, phone };
  }

  async function signIn(owner: { email: string; phone: string }): Promise<string> {
    const login = await http()
      .post(`${COCKPIT}/login`)
      .send({ email: owner.email, password: PASSWORD })
      .expect(200);
    const mfa = await http()
      .post(`${COCKPIT}/mfa`)
      .send({ mfaToken: login.body.mfaToken, code: totp.generate(DEV_COCKPIT_TOTP_SECRET) })
      .expect(200);
    const done = await http()
      .post(`${COCKPIT}/device-otp`)
      .send({
        deviceToken: mfa.body.deviceToken,
        smsCode: codeSentTo(owner.phone, 'COCKPIT_DEVICE_CODE'),
        emailCode: codeSentTo(owner.email, 'COCKPIT_DEVICE_CODE'),
      })
      .expect(200);
    return done.body.access_token;
  }

  /** A code from the NEXT 30 s step: sign-in already spent this one (replay guard). */
  const nextStepCode = () =>
    authenticator
      .clone({ digits: 6, step: 30, window: 1, epoch: Date.now() + 30_000 })
      .generate(DEV_COCKPIT_TOTP_SECRET);

  const enabled = async (token: string) =>
    (await http().get(URL).set('Authorization', `Bearer ${token}`).expect(200)).body.enabled;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.COCKPIT_DOMAIN = process.env.COCKPIT_DOMAIN ?? 'cockpit.biddaloy.test';
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LoginAttemptService)
      .useValue(new LoginAttemptService(redis, 5, 15 * 60_000, 'e2e-switch', false))
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
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
    redis.disconnect();
  });

  it('OFF without a step-up token is refused by ApprovalGuard and changes nothing', async () => {
    await makeOwner(); // a second active owner, so two-person would apply
    const owner = await makeOwner();
    const token = await signIn(owner);

    const res = await http()
      .patch(URL)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
      .expect(403);
    expect(res.body.details?.code).toBe('APPROVAL_REQUIRED');
    expect(await enabled(token)).toBe(true);
  }, 60000);

  it('OFF with a step-up token but no other-owner approval answers APPROVAL_REQUESTED and changes nothing', async () => {
    await makeOwner();
    const owner = await makeOwner();
    const token = await signIn(owner);

    const stepUp = await http()
      .post('/api/v1/platform/step-up')
      .set('Authorization', `Bearer ${token}`)
      .send({ scope: ApprovalScope.PLATFORM_APPROVALS_SWITCH, code: nextStepCode() })
      .expect(200);

    const res = await http()
      .patch(URL)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Approval-Token', stepUp.body.approval_token)
      .send({ enabled: false })
      .expect(403);
    expect(res.body.details?.code).toBe('APPROVAL_REQUESTED');
    expect(res.body.details?.requestId).toEqual(expect.any(String));
    expect(await enabled(token)).toBe(true);
  }, 60000);
});
