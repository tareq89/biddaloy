import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { authenticator } from 'otplib';
import { DEV_COCKPIT_TOTP_SECRET, UserStatus } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_TENANT_ID } from '@test/constants';
import { User } from '../../users/entities/user.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { hashPassword } from '../password-hash';
import { LoginAttemptService } from '../login-attempt.service';
import { MfaService } from '../mfa/mfa.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';

/**
 * [Epic 98 #3747] Cockpit sign-in over real HTTP: password, authenticator, new-device codes,
 * audience separation both ways, lockout at 5, and equal answers for every refusal.
 * Each test makes its own owner (unique suffix), so a lockout or a used TOTP step never leaks.
 */
describe('Cockpit auth E2E', () => {
  const API = '/api/v1/auth/cockpit';
  const PASSWORD = 'Owner-pass-12345';
  const totp = authenticator.clone({ digits: 6, step: 30, window: 1 });
  let app: INestApplication;
  let ds: DataSource;
  let lockoutRedis: Redis;
  // Codes the app "sent": the delivery service is spied on, so the real code is readable.
  let sentCodes: { kind: string; to: string; code?: string }[] = [];

  const post = (path: string, body: object) =>
    supertest(app.getHttpServer()).post(`${API}/${path}`).send(body);

  async function makeOwner() {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const email = `cockpit-e2e-${suffix}@biddaloy.test`;
    const phone = `+88017${suffix.slice(-9).padStart(9, '0')}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email,
        phone,
        full_name: 'Cockpit e2e owner',
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

  const codeSentTo = (to: string, kind: string) =>
    sentCodes.filter((s) => s.to === to && s.kind === kind).at(-1)?.code as string;

  /** Password + authenticator + both device codes -> the "done" answer. */
  async function signIn(owner: { email: string; phone: string }) {
    const login = await post('login', { email: owner.email, password: PASSWORD }).expect(200);
    expect(login.body.step).toBe('mfa');
    const mfa = await post('mfa', {
      mfaToken: login.body.mfaToken,
      code: totp.generate(DEV_COCKPIT_TOTP_SECRET),
    }).expect(200);
    // A new device is not trusted yet: both an SMS and an email code are needed.
    expect(mfa.body.step).toBe('device');
    return post('device-otp', {
      deviceToken: mfa.body.deviceToken,
      smsCode: codeSentTo(owner.phone, 'COCKPIT_DEVICE_CODE'),
      emailCode: codeSentTo(owner.email, 'COCKPIT_DEVICE_CODE'),
    }).expect(200);
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.COCKPIT_DOMAIN = process.env.COCKPIT_DOMAIN ?? 'cockpit.biddaloy.test';
    // Lockout is switched off when NODE_ENV is 'test' (the suite signs in as one admin all day),
    // so this spec builds the real service with the production policy: 5 failures, 15 minutes.
    lockoutRedis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LoginAttemptService)
      .useValue(new LoginAttemptService(lockoutRedis, 5, 15 * 60_000, 'e2e', false))
      .compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    const delivery = app.get(AccountAccessDeliveryService);
    const real = delivery.deliver.bind(delivery);
    vi.spyOn(delivery, 'deliver').mockImplementation((input: any) => {
      sentCodes.push({ kind: input.kind, to: input.to, code: input.vars?.code });
      return real(input);
    });
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
    lockoutRedis.disconnect();
  });

  it('signs an owner in: password, authenticator, then SMS and email codes', async () => {
    const owner = await makeOwner();
    const done = await signIn(owner);
    expect(done.body.step).toBe('done');
    expect(done.body.access_token).toEqual(expect.any(String));
    expect(done.headers['set-cookie'].join(';')).toContain('cockpit');
    expect(done.headers['cache-control']).toContain('no-store');

    // The cockpit token opens the cockpit's own routes.
    await supertest(app.getHttpServer())
      .get(`${API}/sessions`)
      .set('Authorization', `Bearer ${done.body.access_token}`)
      .expect(200);
  }, 30000);

  it('keeps the two audiences apart, both ways', async () => {
    const owner = await makeOwner();
    const done = await signIn(owner);

    // A cockpit token is refused by the school app ...
    await supertest(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${done.body.access_token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(401);

    // ... and a school token is refused by the cockpit.
    const school = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    await supertest(app.getHttpServer())
      .get(`${API}/sessions`)
      .set('Authorization', `Bearer ${school.body.access_token}`)
      .expect(401);
  }, 30000);

  it('answers a wrong password, an unknown account and a non-owner the same way', async () => {
    const owner = await makeOwner();
    const wrong = await post('login', { email: owner.email, password: 'nope-nope-nope' });
    const unknown = await post('login', {
      email: `nobody-${Date.now()}@biddaloy.test`,
      password: PASSWORD,
    });
    // A real school admin with the RIGHT password is still not an owner.
    const notOwner = await post('login', {
      email: SEED_ADMIN_EMAIL,
      password: SEED_ADMIN_PASSWORD,
    });
    for (const res of [wrong, unknown, notOwner]) expect(res.status).toBe(401);
    expect(unknown.body.message).toBe(wrong.body.message);
    expect(notOwner.body.message).toBe(wrong.body.message);
  }, 30000);

  it('locks the identifier after 5 wrong passwords, even for the right one', async () => {
    const owner = await makeOwner();
    for (let i = 0; i < 5; i++) {
      await post('login', { email: owner.email, password: 'wrong-wrong-1' }).expect(401);
    }
    const locked = await post('login', { email: owner.email, password: PASSWORD });
    expect(locked.status).toBe(401);
    // Same sentence as any other refusal: a lock is not told apart.
    const plain = await post('login', { email: `x-${Date.now()}@biddaloy.test`, password: 'y' });
    expect(locked.body.message).toBe(plain.body.message);
  }, 30000);

  it('refuses a replayed authenticator code and a forged step token', async () => {
    const owner = await makeOwner();
    const login = await post('login', { email: owner.email, password: PASSWORD }).expect(200);
    const code = totp.generate(DEV_COCKPIT_TOTP_SECRET);
    await post('mfa', { mfaToken: login.body.mfaToken, code }).expect(200);
    // The same code in the same 30 s step is single-use.
    await post('mfa', { mfaToken: login.body.mfaToken, code }).expect(401);
    await post('mfa', { mfaToken: 'not.a.token', code }).expect(401);
  }, 30000);

  it('forgot-password answers the same for an owner and a stranger', async () => {
    const owner = await makeOwner();
    const known = await post('forgot-password', { identifier: owner.email });
    const stranger = await post('forgot-password', { identifier: `z-${Date.now()}@biddaloy.test` });
    expect(known.status).toBe(stranger.status);
    expect(known.body).toEqual(stranger.body);
  }, 30000);

  it('ends the session on logout: the refresh cookie no longer refreshes', async () => {
    const owner = await makeOwner();
    const done = await signIn(owner);
    const cookies = (done.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]);
    await post('logout', {}).set('Cookie', cookies).expect(204);
    await post('refresh', {}).set('Cookie', cookies).expect(401);
  }, 30000);
});
