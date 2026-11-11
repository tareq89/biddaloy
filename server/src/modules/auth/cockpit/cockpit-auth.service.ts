import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction, CommunicationMedium, UserStatus } from '@biddaloy/shared';
import { toLatinDigits } from '../../../common/utils/bengali-digits.util';
import { AuditService } from '../../audit/audit.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';
import { TemplateKind } from '../../account-access/account-access-templates';
import { OtpPurpose, OtpService, TooManyRequestsException } from '../../account-access/otp.service';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { User } from '../../users/entities/user.entity';
import { LoginAttemptService } from '../login-attempt.service';
import { MfaService } from '../mfa/mfa.service';
import { normalizeLoginIdentifier } from '../normalize-identifier';
import { verifyPassword } from '../password-hash';
import { RequestContext } from '../refresh-token.service';
import { CockpitDeviceService } from './cockpit-device.service';
import { CockpitSessionService } from './cockpit-session.service';
import { CockpitStepTokens } from './cockpit-step-token';
import { CockpitDeviceOtpDto } from './dto/cockpit-device-otp.dto';
import { CockpitLoginDto } from './dto/cockpit-login.dto';
import { CockpitMfaDto } from './dto/cockpit-mfa.dto';

/** The one failure sentence before both proofs pass (Rules 18, 23). */
export const COCKPIT_LOGIN_FAILED = 'Sign-in failed. Check your details and try again.';

/** OtpService identifier for one owner and one channel. Shared with the enrolment ticket. */
export const cockpitOtpIdentifier = (userId: string, medium: 'sms' | 'email') =>
  `${userId}:${medium}`;

/** Lockout key for authenticator and code failures of one owner. */
export const cockpitUserLockKey = (userId: string) => `cockpit:user:${userId}`;
/** Lockout key for password failures on one typed identifier (already normalised). */
export const cockpitIdentifierLockKey = (identifier: string) => `cockpit:${identifier}`;

export type CockpitAuthResult =
  | { step: 'mfa'; mfaToken: string }
  | { step: 'enrol'; enrolToken: string }
  | { step: 'device'; deviceToken: string }
  | {
      step: 'done';
      accessToken: string;
      refreshCookieValue: string;
      /** Set when the owner asked to remember this device. */
      deviceCookieValue?: string;
    };

const TOTP_SHAPE = /^\d{6}$/;

@Injectable()
export class CockpitAuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(PlatformAdmin) private readonly admins: Repository<PlatformAdmin>,
    private readonly loginAttempts: LoginAttemptService,
    private readonly otp: OtpService,
    private readonly delivery: AccountAccessDeliveryService,
    private readonly mfa: MfaService,
    private readonly devices: CockpitDeviceService,
    private readonly sessions: CockpitSessionService,
    private readonly steps: CockpitStepTokens,
    private readonly audit: AuditService,
  ) {}

  // Password failures count on the typed identifier (also for unknown ones, so the answer
  // is equal). Authenticator failures count on the user, and login checks both keys.
  private idKey = cockpitIdentifierLockKey;
  private userKey = cockpitUserLockKey;

  private fail(): never {
    throw new UnauthorizedException(COCKPIT_LOGIN_FAILED);
  }

  async login(dto: CockpitLoginDto, ctx: RequestContext): Promise<CockpitAuthResult> {
    const identifier = normalizeLoginIdentifier(dto.email ?? dto.phone ?? '');
    const idKey = this.idKey(identifier);
    const user = await this.users.findOne({
      where: [{ email: identifier }, { phone: identifier }],
    });
    const isAdmin = user ? await this.admins.exists({ where: { user_id: user.id } }) : false;
    const locked =
      (await this.loginAttempts.isLocked(idKey)) ||
      (user ? await this.loginAttempts.isLocked(this.userKey(user.id)) : false);

    // ALWAYS one bcrypt compare, for a missing or passwordless user too (Rule 18).
    const valid = await verifyPassword(dto.password, user?.password_hash);

    if (!user || !isAdmin || !valid || locked) {
      if (!locked) {
        const { locked: nowLocked } = await this.loginAttempts.recordFailure(idKey);
        if (nowLocked && user && isAdmin) this.alertLockout(user.id, ctx);
      }
      this.fail();
    }

    // A locked (SUSPENDED) owner still gets `mfa`: the lock shows only after both proofs.
    const enrolled = (await this.mfa.status(user.id)).enrolled;
    if (!enrolled && user.status === UserStatus.ACTIVE) {
      await this.sendCode(user, 'COCKPIT_ENROL_SMS', 'SMS', 'COCKPIT_ENROL_CODE');
      await this.sendCode(user, 'COCKPIT_ENROL_EMAIL', 'EMAIL', 'COCKPIT_ENROL_CODE');
      return { step: 'enrol', enrolToken: this.steps.sign(user.id, 'enrol') };
    }
    return { step: 'mfa', mfaToken: this.steps.sign(user.id, 'mfa') };
  }

  async mfaStep(
    dto: CockpitMfaDto,
    ctx: RequestContext,
    deviceCookie: string | undefined,
  ): Promise<CockpitAuthResult> {
    const { userId, authAt } = await this.steps.verify(dto.mfaToken, 'mfa');
    const key = this.userKey(userId);
    if (await this.loginAttempts.isLocked(key)) this.fail();

    const code = toLatinDigits(dto.code.trim());
    const totp = TOTP_SHAPE.test(code);
    const ok = totp
      ? await this.mfa.verifyCode(userId, code)
      : await this.mfa.useRecoveryCode(userId, code);
    if (!ok) {
      const { locked } = await this.loginAttempts.recordFailure(key);
      if (locked) this.alertLockout(userId, ctx);
      this.fail();
    }

    const user = await this.loadOwner(userId);
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        message: 'This account is locked.',
        details: { code: 'ACCOUNT_LOCKED' },
      });
    }
    if (!totp) await this.noteRecoveryUsed(user, ctx);

    if (await this.devices.isKnown(userId, deviceCookie)) return this.finish(user, ctx);

    await this.sendCode(user, 'COCKPIT_DEVICE', 'SMS', 'COCKPIT_DEVICE_CODE');
    await this.sendCode(user, 'COCKPIT_DEVICE', 'EMAIL', 'COCKPIT_DEVICE_CODE');
    // The device step keeps the password time of the mfa step, so a reset still ends it.
    return { step: 'device', deviceToken: this.steps.sign(userId, 'device', authAt) };
  }

  async deviceOtp(dto: CockpitDeviceOtpDto, ctx: RequestContext): Promise<CockpitAuthResult> {
    const { userId } = await this.steps.verify(dto.deviceToken, 'device');
    if (await this.loginAttempts.isLocked(this.userKey(userId))) this.fail();
    const user = await this.loadOwner(userId);
    if (user.status !== UserStatus.ACTIVE || !user.phone || !user.email) this.fail();

    // Both are always checked, so a wrong SMS code is not told apart from a wrong email code.
    // OtpService counts wrong tries and locks on its own.
    const [sms, email] = [
      await this.otp.verify(
        'COCKPIT_DEVICE',
        cockpitOtpIdentifier(userId, 'sms'),
        dto.smsCode,
        user.phone,
      ),
      await this.otp.verify(
        'COCKPIT_DEVICE',
        cockpitOtpIdentifier(userId, 'email'),
        dto.emailCode,
        user.email,
      ),
    ];
    if (sms !== 'ok' || email !== 'ok') this.fail();

    return this.finish(user, ctx, dto.rememberDevice === true);
  }

  /** Both proofs passed: start the session, audit it, and tell the owner. */
  async finish(
    user: User,
    ctx: RequestContext,
    rememberDevice = false,
  ): Promise<Extract<CockpitAuthResult, { step: 'done' }>> {
    const started = await this.sessions.start(user.id, ctx);
    await this.loginAttempts.reset(this.userKey(user.id));
    await this.audit.record({
      action: AuditAction.PLATFORM_LOGIN,
      entity_type: 'PlatformAdmin',
      entity_id: user.id,
      tenant_id: null,
      performed_by_user_id: user.id,
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
    });
    const detail = `IP ${ctx.ip ?? 'unknown'}, ${(ctx.userAgent ?? 'unknown device').slice(0, 80)}, ${new Date().toISOString()}`;
    void this.delivery.detach('cockpit-signin-notice', async () => {
      if (user.email) {
        await this.deliverNotice(user, 'EMAIL', user.email, 'COCKPIT_SIGNIN_NOTICE', { detail });
      }
    });
    return {
      step: 'done',
      accessToken: started.accessToken,
      refreshCookieValue: started.refreshCookieValue,
      deviceCookieValue: rememberDevice
        ? await this.devices.remember(user.id, ctx.userAgent)
        : undefined,
    };
  }

  private async noteRecoveryUsed(user: User, ctx: RequestContext): Promise<void> {
    await this.audit.record({
      action: AuditAction.PLATFORM_RECOVERY_USED,
      entity_type: 'PlatformAdmin',
      entity_id: user.id,
      tenant_id: null,
      performed_by_user_id: user.id,
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
    });
    const count = String((await this.mfa.status(user.id)).recoveryRemaining);
    void this.delivery.detach('cockpit-recovery-notice', async () => {
      if (user.phone)
        await this.deliverNotice(user, 'SMS', user.phone, 'COCKPIT_RECOVERY_NOTICE', { count });
      if (user.email)
        await this.deliverNotice(user, 'EMAIL', user.email, 'COCKPIT_RECOVERY_NOTICE', { count });
    });
  }

  /** 5th failure: one SMS to every active owner and one audit row (no identifier in it). */
  private alertLockout(userId: string, ctx: RequestContext): void {
    void this.delivery.detach('cockpit-lockout-alert', async () => {
      await this.audit.record({
        action: AuditAction.PLATFORM_LOGIN_FAILED,
        entity_type: 'PlatformAdmin',
        entity_id: userId,
        tenant_id: null,
        performed_by_user_id: null,
        ip_address: ctx.ip,
        user_agent: ctx.userAgent,
      });
      const owners = await this.admins.find({ relations: { user: true } });
      for (const owner of owners) {
        const u = owner.user;
        if (u.status === UserStatus.ACTIVE && u.phone) {
          await this.deliverNotice(u, 'SMS', u.phone, 'COCKPIT_LOCKOUT_ALERT', {});
        }
      }
    });
  }

  /** The user behind a step token, which must still be a platform owner; else the one failure. */
  async loadOwner(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !(await this.admins.exists({ where: { user_id: userId } }))) this.fail();
    return user;
  }

  private deliverNotice(
    user: User,
    medium: 'SMS' | 'EMAIL',
    to: string,
    kind: TemplateKind,
    vars: { code?: string; detail?: string; count?: string },
  ) {
    return this.delivery.deliver({
      tenantId: null,
      medium: medium === 'SMS' ? CommunicationMedium.SMS : CommunicationMedium.EMAIL,
      to,
      recipientName: user.full_name,
      kind,
      vars,
    });
  }

  /** Issues a code and sends it. A live cooldown or cap keeps the code already sent. */
  private async sendCode(
    user: User,
    purpose: OtpPurpose,
    medium: 'SMS' | 'EMAIL',
    kind: TemplateKind,
  ): Promise<void> {
    const to = medium === 'SMS' ? user.phone : user.email;
    if (!to) return;
    try {
      const { code } = await this.otp.request(
        purpose,
        cockpitOtpIdentifier(user.id, medium === 'SMS' ? 'sms' : 'email'),
        to,
        { capDestination: to },
      );
      await this.deliverNotice(user, medium, to, kind, { code });
    } catch (error) {
      if (!(error instanceof TooManyRequestsException)) throw error;
    }
  }
}
