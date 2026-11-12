import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { authenticator } from 'otplib';
import { ApprovalScope, DEV_COCKPIT_TOTP_SECRET, UserStatus } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';
import { User } from '../../users/entities/user.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { PlatformHomeService } from '../../platform-identity/platform-home.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';
import { hashPassword } from '../password-hash';
import { MfaService } from '../mfa/mfa.service';

/**
 * [Epic 98 #4062] The owner's authenticator status and recovery-code regenerate over real HTTP:
 * status for the caller only, regenerate needs a step-up token, the old codes die, a school
 * token is refused.
 */
describe('Cockpit MFA routes E2E', () => {
  const COCKPIT = '/api/v1/auth/cockpit';
  const PASSWORD = 'Owner-pass-12345';
  const totp = authenticator.clone({ digits: 6, step: 30, window: 1 });
  let app: INestApplication;
  let ds: DataSource;
  let baseUrl = '';
  const sentCodes: { kind: string; to: string; code?: string }[] = [];
  const http = () => supertest(baseUrl);
  const codeSentTo = (to: string, kind: string) =>
    sentCodes.filter((s) => s.to === to && s.kind === kind).at(-1)?.code as string;
  const freshStep = (userId: string) =>
    ds.query(`UPDATE user_mfa SET last_step = NULL WHERE user_id = $1`, [userId]);

  async function makeOwner() {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const email = `cockpit-mfa-e2e-${suffix}@biddaloy.test`;
    const phone = `+88017${suffix.slice(-9).padStart(9, '0')}`;
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        email,
        phone,
        full_name: 'Cockpit MFA e2e owner',
        status: UserStatus.ACTIVE,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
        phone_verified_at: new Date(),
      }),
    );
    await ds.getRepository(PlatformAdmin).insert({ user_id: user.id });
    await app.get(MfaService).enrolWithKnownSecret(user.id, DEV_COCKPIT_TOTP_SECRET);
    const login = await http().post(`${COCKPIT}/login`).send({ email, password: PASSWORD });
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
    return { id: user.id, auth: { Authorization: `Bearer ${done.body.access_token}` } };
  }

  async function stepUp(o: { id: string; auth: { Authorization: string } }): Promise<string> {
    await freshStep(o.id);
    const res = await http()
      .post('/api/v1/platform/step-up')
      .set(o.auth)
      .send({
        scope: ApprovalScope.PLATFORM_RECOVERY_CODES,
        code: totp.generate(DEV_COCKPIT_TOTP_SECRET),
      })
      .expect(200);
    return res.body.approval_token;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.COCKPIT_DOMAIN = process.env.COCKPIT_DOMAIN ?? 'cockpit.biddaloy.test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.listen(0);
    baseUrl = await app.getUrl();
    ds = app.get(DataSource);
    await app.get(PlatformHomeService).ensure();
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
  });

  it('status reports enrolled and the codes left; no bearer is 401', async () => {
    const o = await makeOwner();
    const res = await http().get(`${COCKPIT}/mfa-status`).set(o.auth).expect(200);
    expect(res.body).toEqual({ enrolled: true, recoveryRemaining: expect.any(Number) });
    expect(res.headers['cache-control']).toContain('no-store');
    await http().get(`${COCKPIT}/mfa-status`).expect(401);
  }, 60000);

  it('regenerate needs a step-up token, kills the old codes, and the token is single-use', async () => {
    const o = await makeOwner();
    const mfa = app.get(MfaService);
    // Enrolment with a known secret makes no codes; make a set so there is something to kill.
    const [oldCode] = await mfa.regenerateRecoveryCodes(o.id);

    await http().post(`${COCKPIT}/recovery-codes`).set(o.auth).expect(403);

    const token = await stepUp(o);
    const res = await http()
      .post(`${COCKPIT}/recovery-codes`)
      .set(o.auth)
      .set('X-Approval-Token', token)
      .expect(200);
    expect(res.body.recoveryCodes).toHaveLength(10);
    expect(res.body.recoveryCodes).not.toContain(oldCode);
    expect(res.headers['cache-control']).toContain('no-store');

    expect(await mfa.useRecoveryCode(o.id, oldCode)).toBe(false);
    expect(await mfa.useRecoveryCode(o.id, res.body.recoveryCodes[0])).toBe(true);
    expect((await http().get(`${COCKPIT}/mfa-status`).set(o.auth).expect(200)).body).toEqual({
      enrolled: true,
      recoveryRemaining: 9,
    });

    // Same token again: already consumed.
    await http()
      .post(`${COCKPIT}/recovery-codes`)
      .set(o.auth)
      .set('X-Approval-Token', token)
      .expect(403);
  }, 60000);

  it('refuses a step-up token minted for another scope', async () => {
    const o = await makeOwner();
    await freshStep(o.id);
    const other = await http()
      .post('/api/v1/platform/step-up')
      .set(o.auth)
      .send({
        scope: ApprovalScope.PLATFORM_OWNER_LOCK,
        code: totp.generate(DEV_COCKPIT_TOTP_SECRET),
      })
      .expect(200);
    await http()
      .post(`${COCKPIT}/recovery-codes`)
      .set(o.auth)
      .set('X-Approval-Token', other.body.approval_token)
      .expect(403);
  }, 60000);

  it('refuses a token minted by a different owner', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const tokenOfB = await stepUp(b);
    await http()
      .post(`${COCKPIT}/recovery-codes`)
      .set(a.auth)
      .set('X-Approval-Token', tokenOfB)
      .expect(403);
  }, 60000);

  it('two concurrent regenerates: exactly one set stays valid', async () => {
    const o = await makeOwner();
    const t1 = await stepUp(o);
    const t2 = await stepUp(o);
    // Deterministic hold: both requests sit inside their transaction at `replaceCodes` (before the
    // row lock) until both have arrived, so the lock, not request timing, orders them.
    type Proto = { replaceCodes: (...a: unknown[]) => Promise<string[]> };
    const proto = MfaService.prototype as unknown as Proto;
    const real = proto.replaceCodes;
    let arrived = 0;
    let release!: () => void;
    const both = new Promise<void>((resolve) => (release = resolve));
    const hold = vi.spyOn(proto, 'replaceCodes').mockImplementation(function (
      this: unknown,
      ...args: unknown[]
    ) {
      if (++arrived === 2) release();
      return both.then(() => real.apply(this, args));
    });
    let r1: supertest.Response;
    let r2: supertest.Response;
    try {
      [r1, r2] = await Promise.all(
        [t1, t2].map((t) =>
          http().post(`${COCKPIT}/recovery-codes`).set(o.auth).set('X-Approval-Token', t),
        ),
      );
    } finally {
      hold.mockRestore();
    }
    expect(arrived).toBe(2);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const rows = await ds.query(
      `SELECT count(*)::int AS n FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
      [o.id],
    );
    expect(rows[0].n).toBe(10);
    const mfa = app.get(MfaService);
    const valid = await Promise.all(
      [...r1.body.recoveryCodes, ...r2.body.recoveryCodes].map((c: string) =>
        mfa.useRecoveryCode(o.id, c),
      ),
    );
    expect(valid.filter(Boolean)).toHaveLength(10);
  }, 60000);

  it('refuses a school ADMIN token on both routes', async () => {
    const school = await http()
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const bearer = { Authorization: `Bearer ${school.body.access_token}` };
    await http().get(`${COCKPIT}/mfa-status`).set(bearer).expect(401);
    await http().post(`${COCKPIT}/recovery-codes`).set(bearer).expect(401);
  }, 60000);
});
