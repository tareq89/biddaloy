import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuditAction, UserStatus } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { OtpService } from '../../account-access/otp.service';
import { LoginAttemptService } from '../login-attempt.service';
import { MfaService } from '../mfa/mfa.service';
import { RequestContext } from '../refresh-token.service';
import {
  COCKPIT_LOGIN_FAILED,
  CockpitAuthResult,
  CockpitAuthService,
  cockpitOtpIdentifier,
  cockpitUserLockKey,
} from './cockpit-auth.service';
import { CockpitStepTokens } from './cockpit-step-token';
import { CockpitEnrolConfirmDto, CockpitEnrolStartDto } from './dto/cockpit-enrol.dto';

/**
 * [Epic 98] Owner authenticator enrolment. Start needs the `enrol` step token AND an SMS code AND
 * an email code, so a stolen reset link or password alone cannot enrol an attacker's authenticator (D7).
 */
@Injectable()
export class CockpitEnrolService {
  constructor(
    private readonly auth: CockpitAuthService,
    private readonly steps: CockpitStepTokens,
    private readonly otp: OtpService,
    private readonly mfa: MfaService,
    private readonly loginAttempts: LoginAttemptService,
    private readonly audit: AuditService,
  ) {}

  private fail(): never {
    throw new UnauthorizedException(COCKPIT_LOGIN_FAILED);
  }

  async start(dto: CockpitEnrolStartDto): Promise<{ otpauthUri: string; secret: string }> {
    const { userId } = await this.steps.verify(dto.enrolToken, 'enrol');
    if (await this.loginAttempts.isLocked(cockpitUserLockKey(userId))) this.fail();
    const user = await this.auth.loadOwner(userId);
    if (user.status !== UserStatus.ACTIVE || !user.phone || !user.email) this.fail();

    // Both are always checked (no oracle on which one was wrong); OtpService locks on its own.
    const sms = await this.otp.verify(
      'COCKPIT_ENROL_SMS',
      cockpitOtpIdentifier(userId, 'sms'),
      dto.smsCode,
      user.phone,
    );
    const email = await this.otp.verify(
      'COCKPIT_ENROL_EMAIL',
      cockpitOtpIdentifier(userId, 'email'),
      dto.emailCode,
      user.email,
    );
    if (sms !== 'ok' || email !== 'ok') this.fail();

    const { secret, uri } = await this.mfa.beginEnrolment(userId, user.email);
    return { otpauthUri: uri, secret };
  }

  /** Confirms with the first authenticator code, then signs the owner in (recovery codes shown once). */
  async confirm(
    dto: CockpitEnrolConfirmDto,
    ctx: RequestContext,
  ): Promise<{ recoveryCodes: string[]; session: Extract<CockpitAuthResult, { step: 'done' }> }> {
    const { userId } = await this.steps.verify(dto.enrolToken, 'enrol');
    const key = cockpitUserLockKey(userId);
    if (await this.loginAttempts.isLocked(key)) this.fail();
    const user = await this.auth.loadOwner(userId);
    if (user.status !== UserStatus.ACTIVE) this.fail();

    let recoveryCodes: string[];
    try {
      recoveryCodes = await this.mfa.confirmEnrolment(userId, dto.code.trim());
    } catch {
      await this.loginAttempts.recordFailure(key);
      return this.fail();
    }
    await this.audit.record({
      action: AuditAction.PLATFORM_MFA_ENROLLED,
      entity_type: 'PlatformAdmin',
      entity_id: userId,
      tenant_id: null,
      performed_by_user_id: userId,
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
    });
    const session = await this.auth.finish(user, ctx, dto.rememberDevice === true);
    return { recoveryCodes, session };
  }
}
