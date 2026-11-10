import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, UserStatus } from '@biddaloy/shared';
import { TooManyRequestsException } from '../../account-access/otp.service';
import { CockpitAuthService, COCKPIT_LOGIN_FAILED } from './cockpit-auth.service';
import { CockpitStepTokens } from './cockpit-step-token';

// bcrypt is covered by password-hash.spec.ts; here only the answer matters.
const verifyPassword = vi.fn();
vi.mock('../password-hash', () => ({ verifyPassword: (...a: unknown[]) => verifyPassword(...a) }));

const SECRET = 'cockpit-auth-secret-cockpit-auth-12';
const ctx = { ip: '9.9.9.9', userAgent: 'Chrome on Mac' };
const owner = (over: object = {}) => ({
  id: 'u1',
  full_name: 'Owner One',
  email: 'one@x.com',
  phone: '01711111111',
  password_hash: 'h',
  status: UserStatus.ACTIVE,
  ...over,
});

describe('CockpitAuthService', () => {
  let user: any;
  let isAdmin: boolean;
  let locked: Set<string>;
  let attempts: any;
  let otp: any;
  let delivery: any;
  let mfa: any;
  let devices: any;
  let sessions: any;
  let audit: any;
  let steps: CockpitStepTokens;
  let svc: CockpitAuthService;
  let owners: any[];

  beforeEach(() => {
    user = owner();
    isAdmin = true;
    locked = new Set();
    owners = [{ user: owner({ id: 'u1' }) }, { user: owner({ id: 'u2', phone: '01722222222' }) }];
    verifyPassword.mockReset().mockResolvedValue(true);
    attempts = {
      isLocked: vi.fn(async (k: string) => locked.has(k)),
      recordFailure: vi.fn().mockResolvedValue({ locked: false, delayMs: 0 }),
      reset: vi.fn(),
    };
    otp = {
      request: vi.fn().mockResolvedValue({ code: '123456' }),
      verify: vi.fn().mockResolvedValue('ok'),
    };
    delivery = {
      deliver: vi.fn().mockResolvedValue({}),
      detach: vi.fn(async (_f: string, work: () => Promise<unknown>) => work()),
    };
    mfa = {
      status: vi.fn().mockResolvedValue({ enrolled: true, recoveryRemaining: 7 }),
      verifyCode: vi.fn().mockResolvedValue(true),
      useRecoveryCode: vi.fn().mockResolvedValue(true),
    };
    devices = {
      isKnown: vi.fn().mockResolvedValue(false),
      remember: vi.fn().mockResolvedValue('device-secret'),
    };
    sessions = {
      start: vi
        .fn()
        .mockResolvedValue({ accessToken: 'at', refreshCookieValue: 'rc', familyId: 'f' }),
    };
    audit = { record: vi.fn() };
    const jwt = new JwtService({
      secret: SECRET,
      signOptions: { issuer: 'biddaloy', algorithm: 'HS256' },
    });
    steps = new CockpitStepTokens(jwt, {
      get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined),
    } as any);
    const users = {
      findOne: vi.fn(async ({ where }: any) =>
        Array.isArray(where) ? user : user?.id === where.id ? user : null,
      ),
    };
    const admins = { exists: vi.fn(async () => isAdmin), find: vi.fn(async () => owners) };
    svc = new CockpitAuthService(
      users as any,
      admins as any,
      attempts,
      otp,
      delivery,
      mfa,
      devices,
      sessions,
      steps,
      audit,
    );
  });

  const login = () => svc.login({ email: 'ONE@x.com', password: 'pw' } as any, ctx);
  const failure = async (p: Promise<unknown>) => {
    const err: any = await p.catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    return { status: err.getStatus(), body: err.getResponse() };
  };

  describe('login', () => {
    it('answers every pre-proof failure identically', async () => {
      const answers: unknown[] = [];

      user = null; // unknown email
      answers.push(await failure(login()));

      user = owner(); // known email, wrong password
      verifyPassword.mockResolvedValue(false);
      answers.push(await failure(login()));

      user = owner({ status: UserStatus.SUSPENDED }); // locked owner, wrong password
      answers.push(await failure(login()));

      verifyPassword.mockResolvedValue(true); // locked identifier key, even with the right password
      locked.add('cockpit:one@x.com');
      answers.push(await failure(login()));

      locked.clear();
      isAdmin = false; // a normal app user with the right password
      answers.push(await failure(login()));

      expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
      expect(answers[0]).toMatchObject({
        body: expect.objectContaining({ message: COCKPIT_LOGIN_FAILED }),
      });
    });

    it('always runs the password compare, also for an unknown user', async () => {
      user = null;
      await failure(login());
      expect(verifyPassword).toHaveBeenCalledWith('pw', undefined);
    });

    it('normalises the identifier into the lockout key', async () => {
      user = null;
      await failure(login());
      expect(attempts.recordFailure).toHaveBeenCalledWith('cockpit:one@x.com');
    });

    it('5th failure: one SMS alert to each active owner and one audit row without the identifier', async () => {
      attempts.recordFailure.mockResolvedValue({ locked: true, delayMs: 0 });
      verifyPassword.mockResolvedValue(false);
      await failure(login());
      const smsTo = delivery.deliver.mock.calls
        .map((c: any) => c[0])
        .filter((i: any) => i.kind === 'COCKPIT_LOCKOUT_ALERT');
      expect(smsTo.map((i: any) => i.to).sort()).toEqual(['01711111111', '01722222222']);
      expect(smsTo.every((i: any) => i.medium === 'SMS' && i.tenantId === null)).toBe(true);
      expect(audit.record).toHaveBeenCalledTimes(1);
      const row = audit.record.mock.calls[0][0];
      expect(row).toMatchObject({ action: AuditAction.PLATFORM_LOGIN_FAILED, tenant_id: null });
      expect(JSON.stringify(row)).not.toContain('one@x.com');
    });

    it('an unknown identifier hitting the limit alerts nobody', async () => {
      user = null;
      attempts.recordFailure.mockResolvedValue({ locked: true, delayMs: 0 });
      await failure(login());
      expect(delivery.deliver).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('a password failure while already locked does not count again or alert', async () => {
      locked.add('cockpit:one@x.com');
      await failure(login());
      expect(attempts.recordFailure).not.toHaveBeenCalled();
    });

    it('enrolled owner gets the mfa step, a locked owner too', async () => {
      expect(await login()).toMatchObject({ step: 'mfa' });
      user = owner({ status: UserStatus.SUSPENDED });
      expect(await login()).toMatchObject({ step: 'mfa' });
      expect(otp.request).not.toHaveBeenCalled();
    });

    it('owner without authenticator gets the enrol step and an SMS plus an email code', async () => {
      mfa.status.mockResolvedValue({ enrolled: false, recoveryRemaining: 0 });
      expect(await login()).toMatchObject({ step: 'enrol' });
      expect(otp.request.mock.calls.map((c: any) => c[0])).toEqual([
        'COCKPIT_ENROL_SMS',
        'COCKPIT_ENROL_EMAIL',
      ]);
      expect(delivery.deliver.mock.calls.map((c: any) => c[0].medium).sort()).toEqual([
        'EMAIL',
        'SMS',
      ]);
    });

    it('a cooldown on a code already sent does not fail the login', async () => {
      mfa.status.mockResolvedValue({ enrolled: false, recoveryRemaining: 0 });
      otp.request.mockRejectedValue(new TooManyRequestsException());
      expect(await login()).toMatchObject({ step: 'enrol' });
    });
  });

  describe('mfaStep', () => {
    const mfaStep = (code: string, cookie?: string, token = steps.sign('u1', 'mfa')) =>
      svc.mfaStep({ mfaToken: token, code } as any, ctx, cookie);

    it('rejects a token for another step with the step sentence', async () => {
      await expect(mfaStep('123456', undefined, steps.sign('u1', 'device'))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('a wrong code fails with the generic body and counts on the user key', async () => {
      mfa.verifyCode.mockResolvedValue(false);
      const a = await failure(mfaStep('123456'));
      expect(a.body).toMatchObject({ message: COCKPIT_LOGIN_FAILED });
      expect(attempts.recordFailure).toHaveBeenCalledWith('cockpit:user:u1');
    });

    it('a locked user key fails before any code is checked', async () => {
      locked.add('cockpit:user:u1');
      await failure(mfaStep('123456'));
      expect(mfa.verifyCode).not.toHaveBeenCalled();
    });

    it('a locked owner gets 403 ACCOUNT_LOCKED only after the proof', async () => {
      user = owner({ status: UserStatus.SUSPENDED });
      const err: any = await mfaStep('123456').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ details: { code: 'ACCOUNT_LOCKED' } });
      expect(sessions.start).not.toHaveBeenCalled();
    });

    it('a known device starts the session, audits PLATFORM_LOGIN and emails a notice', async () => {
      devices.isKnown.mockResolvedValue(true);
      const out = await mfaStep('123456', 'cookie');
      expect(out).toMatchObject({ step: 'done', accessToken: 'at', refreshCookieValue: 'rc' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.PLATFORM_LOGIN, tenant_id: null }),
      );
      const notice = delivery.deliver.mock.calls
        .map((c: any) => c[0])
        .find((i: any) => i.kind === 'COCKPIT_SIGNIN_NOTICE');
      expect(notice).toMatchObject({ medium: 'EMAIL', to: 'one@x.com' });
      expect(notice.vars.detail).toContain('9.9.9.9');
    });

    it('an unknown device gets step device and an SMS plus an email code, no session', async () => {
      const out = await mfaStep('123456');
      expect(out).toMatchObject({ step: 'device' });
      expect(otp.request.mock.calls.map((c: any) => c[0])).toEqual([
        'COCKPIT_DEVICE',
        'COCKPIT_DEVICE',
      ]);
      expect(sessions.start).not.toHaveBeenCalled();
    });

    it('recovery code works once; the notice reports the number left', async () => {
      devices.isKnown.mockResolvedValue(true);
      mfa.status.mockResolvedValue({ enrolled: true, recoveryRemaining: 6 });
      await mfaStep('abcd-efgh-jkmn-pqrs');
      expect(mfa.useRecoveryCode).toHaveBeenCalledWith('u1', 'abcd-efgh-jkmn-pqrs');
      expect(mfa.verifyCode).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.PLATFORM_RECOVERY_USED }),
      );
      const notices = delivery.deliver.mock.calls
        .map((c: any) => c[0])
        .filter((i: any) => i.kind === 'COCKPIT_RECOVERY_NOTICE');
      expect(notices.map((n: any) => n.medium).sort()).toEqual(['EMAIL', 'SMS']);
      expect(notices[0].vars.count).toBe('6');

      mfa.useRecoveryCode.mockResolvedValue(false); // the same code a second time
      await failure(mfaStep('abcd-efgh-jkmn-pqrs'));
    });

    it('the 5th wrong code alerts the owners', async () => {
      mfa.verifyCode.mockResolvedValue(false);
      attempts.recordFailure.mockResolvedValue({ locked: true, delayMs: 0 });
      await failure(mfaStep('123456'));
      expect(
        delivery.deliver.mock.calls.some((c: any) => c[0].kind === 'COCKPIT_LOCKOUT_ALERT'),
      ).toBe(true);
    });
  });

  describe('deviceOtp', () => {
    const device = (over: object = {}) =>
      svc.deviceOtp(
        {
          deviceToken: steps.sign('u1', 'device'),
          smsCode: '111111',
          emailCode: '222222',
          ...over,
        } as any,
        ctx,
      );

    it('needs both codes: either wrong fails and no session starts', async () => {
      otp.verify.mockResolvedValueOnce('ok').mockResolvedValueOnce('invalid');
      await failure(device());
      otp.verify.mockResolvedValueOnce('invalid').mockResolvedValueOnce('ok');
      await failure(device());
      expect(sessions.start).not.toHaveBeenCalled();
      expect(otp.verify).toHaveBeenCalledTimes(4); // both checked every time
    });

    it('a locked OTP counts as a failure', async () => {
      otp.verify.mockResolvedValue('locked');
      await failure(device());
    });

    it('both codes start the session without a cookie unless asked', async () => {
      const out: any = await device();
      expect(out).toMatchObject({ step: 'done' });
      expect(out.deviceCookieValue).toBeUndefined();
      expect(devices.remember).not.toHaveBeenCalled();
      expect(otp.verify).toHaveBeenCalledWith('COCKPIT_DEVICE', 'u1:sms', '111111', '01711111111');
      expect(otp.verify).toHaveBeenCalledWith('COCKPIT_DEVICE', 'u1:email', '222222', 'one@x.com');
    });

    it('rememberDevice stores a row and returns the cookie secret', async () => {
      const out: any = await device({ rememberDevice: true });
      expect(devices.remember).toHaveBeenCalledWith('u1', 'Chrome on Mac');
      expect(out.deviceCookieValue).toBe('device-secret');
    });

    it('an mfa token cannot be used here', async () => {
      await expect(device({ deviceToken: steps.sign('u1', 'mfa') })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
