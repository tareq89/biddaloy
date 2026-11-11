import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, UserStatus } from '@biddaloy/shared';
import { CockpitEnrolService } from './cockpit-enrol.service';
import { CockpitStepTokens } from './cockpit-step-token';

const SECRET = 'cockpit-enrol-secret-cockpit-enrol-12';
const ctx = { ip: '1.1.1.1', userAgent: 'ua' };

describe('CockpitEnrolService', () => {
  let user: any;
  let locked: boolean;
  let auth: any;
  let otp: any;
  let mfa: any;
  let attempts: any;
  let audit: any;
  let steps: CockpitStepTokens;
  let svc: CockpitEnrolService;
  const token = () => steps.sign('u1', 'enrol');

  beforeEach(() => {
    user = { id: 'u1', email: 'one@x.com', phone: '01711111111', status: UserStatus.ACTIVE };
    locked = false;
    auth = {
      loadOwner: vi.fn(async () => user),
      finish: vi
        .fn()
        .mockResolvedValue({ step: 'done', accessToken: 'at', refreshCookieValue: 'rc' }),
    };
    otp = { verify: vi.fn().mockResolvedValue('ok') };
    mfa = {
      beginEnrolment: vi.fn().mockResolvedValue({ secret: 'S', uri: 'otpauth://x' }),
      confirmEnrolment: vi.fn().mockResolvedValue(['c1', 'c2']),
    };
    attempts = { isLocked: vi.fn(async () => locked), recordFailure: vi.fn() };
    audit = { record: vi.fn() };
    const jwt = new JwtService({
      secret: SECRET,
      signOptions: { issuer: 'biddaloy', algorithm: 'HS256' },
    });
    steps = new CockpitStepTokens(
      jwt,
      { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) } as any,
      { findOne: vi.fn(async () => ({ id: 'u1', tokens_valid_after: null })) } as any,
    );
    svc = new CockpitEnrolService(auth, steps, otp, mfa, attempts, audit);
  });

  describe('start', () => {
    const start = (over: object = {}) =>
      svc.start({ enrolToken: token(), smsCode: '111111', emailCode: '222222', ...over } as any);

    it('with both codes returns the secret and URI', async () => {
      expect(await start()).toEqual({ otpauthUri: 'otpauth://x', secret: 'S' });
      expect(otp.verify).toHaveBeenCalledWith(
        'COCKPIT_ENROL_SMS',
        'u1:sms',
        '111111',
        '01711111111',
      );
      expect(otp.verify).toHaveBeenCalledWith(
        'COCKPIT_ENROL_EMAIL',
        'u1:email',
        '222222',
        'one@x.com',
      );
    });

    it('an already-enrolled owner gets the 409 from beginEnrolment, nothing else', async () => {
      mfa.beginEnrolment.mockRejectedValueOnce(
        new ConflictException('Authenticator is already set up.'),
      );
      await expect(start()).rejects.toBeInstanceOf(ConflictException);
    });

    it('never begins enrolment unless BOTH codes are right', async () => {
      otp.verify.mockResolvedValueOnce('ok').mockResolvedValueOnce('invalid'); // email wrong
      await expect(start()).rejects.toBeInstanceOf(UnauthorizedException);
      otp.verify.mockResolvedValueOnce('invalid').mockResolvedValueOnce('ok'); // sms wrong
      await expect(start()).rejects.toBeInstanceOf(UnauthorizedException);
      otp.verify.mockResolvedValue('locked');
      await expect(start()).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mfa.beginEnrolment).not.toHaveBeenCalled();
    });

    it('a token of another step, a locked key and a locked owner are all refused', async () => {
      await expect(start({ enrolToken: steps.sign('u1', 'mfa') })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      locked = true;
      await expect(start()).rejects.toBeInstanceOf(UnauthorizedException);
      locked = false;
      user.status = UserStatus.SUSPENDED;
      await expect(start()).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mfa.beginEnrolment).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    const confirm = (over: object = {}) =>
      svc.confirm({ enrolToken: token(), code: '123456', ...over } as any, ctx);

    it('returns the recovery codes once, audits and starts the session', async () => {
      const out = await confirm({ rememberDevice: true });
      expect(out.recoveryCodes).toEqual(['c1', 'c2']);
      expect(out.session.accessToken).toBe('at');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.PLATFORM_MFA_ENROLLED, tenant_id: null }),
      );
      expect(auth.finish).toHaveBeenCalledWith(user, ctx, true);
    });

    it('a wrong code counts as a failure, starts no session and writes no audit', async () => {
      mfa.confirmEnrolment.mockRejectedValue(new BadRequestException('Code is not valid.'));
      await expect(confirm()).rejects.toBeInstanceOf(UnauthorizedException);
      expect(attempts.recordFailure).toHaveBeenCalledWith('cockpit:user:u1');
      expect(auth.finish).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('a locked owner or locked key cannot confirm', async () => {
      user.status = UserStatus.SUSPENDED;
      await expect(confirm()).rejects.toBeInstanceOf(UnauthorizedException);
      user.status = UserStatus.ACTIVE;
      locked = true;
      await expect(confirm()).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mfa.confirmEnrolment).not.toHaveBeenCalled();
    });
  });
});
