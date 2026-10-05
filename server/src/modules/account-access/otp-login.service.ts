import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import {
  AuditAction,
  AuthTokenPurpose,
  CommunicationMedium,
  UserStatus,
  audienceForRoles,
} from '@biddaloy/shared';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { UserIdentity } from '../auth/entities/user-identity.entity';
import { AuditService } from '../audit/audit.service';
import { AuthService, AuthResult } from '../auth/auth.service';
import { LoginAttemptService } from '../auth/login-attempt.service';
import { RequestContext } from '../auth/refresh-token.service';
import { normalizeLoginIdentifier } from '../auth/normalize-identifier';
import { SchoolsService } from '../schools/schools.service';
import { OtpService } from './otp.service';
import { AuthTokenService } from './auth-token.service';
import { AccountAccessDeliveryService } from './account-access-delivery.service';
import { isSecretEchoEnabled } from './account-access-echo';

const OTP_PURPOSE = 'LOGIN';

/** D31: SMS codes only go to numbers with an allowed prefix (default Bangladesh); others get the code by email. */
const DEFAULT_SMS_PREFIXES = '+880';

export interface OtpLoginVerifyResult extends AuthResult {
  needs_password: boolean;
  password_required: boolean;
}

export interface OtpLoginRequestResult {
  debug?: { otp?: string };
}

/**
 * `POST /auth/otp/request` + `POST /auth/otp/verify` (12.5) — passwordless
 * phone+OTP sign-in built entirely out of 12.1's `OtpService` (D3), issuing
 * the exact same session shape `AuthService.login` does.
 *
 * A per-tenant `auth.otpLoginEnabled` setting (default true, D-corrected
 * plan) lets a school turn this off. A user can belong to several tenants,
 * so **deny wins**: OTP login is allowed only if *every* tenant the user
 * belongs to has it enabled — one school opting out must not be bypassable
 * via another membership.
 */
@Injectable()
export class OtpLoginService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    @InjectRepository(UserIdentity)
    private readonly identityRepo: Repository<UserIdentity>,
    private readonly authTokens: AuthTokenService,
    private readonly otpService: OtpService,
    private readonly delivery: AccountAccessDeliveryService,
    private readonly authService: AuthService,
    private readonly loginAttempts: LoginAttemptService,
    private readonly auditService: AuditService,
    private readonly schoolsService: SchoolsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Enumeration-safe: always resolves 202, never reveals whether `phone`
   * matches an account, is inactive, or belongs only to tenants with OTP
   * login switched off. D6's echo flag is the only way a test can observe
   * the OTP this issues.
   */
  async request(rawIdentifier: string, context: RequestContext): Promise<OtpLoginRequestResult> {
    const identifier = normalizeLoginIdentifier(rawIdentifier);
    const user = await this.findUser(identifier);

    if (!user || !this.canSignInByCode(user) || !(await this.allowed(user.id))) {
      return {};
    }

    // Email identifier -> email. Phone -> SMS, unless its prefix is not allowed
    // (then the user's email, if any). Nothing deliverable -> nothing sent;
    // the caller still sees the same 202.
    const byEmail = isEmail(identifier) || !this.smsAllowed(identifier);
    const to = byEmail ? user.email : user.phone;
    if (!to) return {};

    const tenantId = await this.authService.primaryTenantId(user.id);
    if (!tenantId) return {};

    let code: string;
    try {
      ({ code } = await this.otpService.request(OTP_PURPOSE, identifier));
    } catch {
      // A 429 from the cooldown must not leak beyond the same 202 every
      // other branch returns — see RecoveryService.sendOtp for the same
      // reasoning.
      return this.echo({});
    }

    await this.delivery.deliver({
      tenantId,
      medium: byEmail ? CommunicationMedium.EMAIL : CommunicationMedium.SMS,
      to,
      recipientName: user.full_name,
      kind: 'OTP',
      vars: { code },
    });

    return this.echo({ otp: code });
  }

  /**
   * Returns the same `AuthResult` shape `AuthService.login` does. Failure —
   * unknown phone, wrong/expired code, inactive user, or a tenant that has
   * switched OTP login off — always throws the same
   * `UnauthorizedException('Invalid credentials')` password login uses, so
   * neither response body nor message distinguishes the failure reason.
   */
  async verify(
    rawIdentifier: string,
    otp: string,
    context: RequestContext,
  ): Promise<OtpLoginVerifyResult> {
    const identifier = normalizeLoginIdentifier(rawIdentifier);
    const result = await this.otpService.verify(OTP_PURPOSE, identifier, otp);

    if (result === 'locked') {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many attempts' },
        HttpStatus.TOO_MANY_REQUESTS,
        { description: 'Retry-After: 900' },
      );
    }

    const user = await this.findUser(identifier);
    const success =
      result === 'ok' && !!user && this.canSignInByCode(user) && (await this.allowed(user.id));

    if (!success) {
      await this.auditService.record({
        action: AuditAction.LOGIN_FAILED,
        entity_type: 'User',
        entity_id: user?.id ?? null,
        tenant_id: user ? await this.authService.primaryTenantId(user.id) : null,
        performed_by_user_id: user?.id ?? null,
        ip_address: context.ip,
        user_agent: context.userAgent,
        new_values: { identifier, method: 'otp' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.loginAttempts.reset(identifier);

    // An invited user who never activated signs in here: flip them ACTIVE (as
    // activation does) and mark their invite accepted.
    await this.userRepo.update(
      { id: user.id },
      {
        last_login_at: new Date(),
        ...(user.status === UserStatus.INACTIVE ? { status: UserStatus.ACTIVE } : {}),
      },
    );
    await this.authTokens.consumeLive(user.id, AuthTokenPurpose.INVITE);

    // [12.7] A successful OTP verify proves the caller controls this phone
    // — stamp it, but only the first time (never overwrite an existing
    // verification timestamp with a later one).
    //
    // Compare-and-set on `phone`, not a bare update by id: the OTP proves
    // control of `identifier`, and an admin edit landing between the read
    // above and this write would otherwise let it mark a REPLACEMENT phone
    // verified — one this caller never proved. Matching `phone` (and
    // `IS NULL` on the timestamp, so a concurrent double-stamp is a no-op)
    // keeps the stamp bound to the number the code was actually sent to.
    // An email code proves the email, an SMS code the phone.
    const field = isEmail(identifier) && user.email === identifier ? 'email' : 'phone';
    const alreadyVerified =
      field === 'email' ? user.email_verified_at !== null : user.phone_verified_at !== null;
    let stamped = false;
    if (!alreadyVerified) {
      const where: FindOptionsWhere<User> =
        field === 'email'
          ? { id: user.id, email: identifier, email_verified_at: IsNull() }
          : { id: user.id, phone: identifier, phone_verified_at: IsNull() };
      const stamp = await this.userRepo.update(
        where,
        field === 'email' ? { email_verified_at: new Date() } : { phone_verified_at: new Date() },
      );
      stamped = stamp.affected === 1;
    }

    const tenantId = await this.authService.primaryTenantId(user.id);
    await this.auditService.record({
      action: AuditAction.LOGIN,
      entity_type: 'User',
      entity_id: user.id,
      tenant_id: tenantId,
      performed_by_user_id: user.id,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { method: 'otp' },
    });

    // Only audit a verification that actually landed — see the
    // compare-and-set above.
    if (stamped) {
      await this.auditService.record({
        action: AuditAction.CONTACT_VERIFIED,
        entity_type: 'User',
        entity_id: user.id,
        tenant_id: tenantId,
        performed_by_user_id: user.id,
        ip_address: context.ip,
        user_agent: context.userAgent,
        new_values: { field, via: 'otp_login' },
      });
    }

    const needsPassword = user.password_hash === null;
    const roles = (await this.userTenantRepo.find({ where: { user_id: user.id } })).map(
      (m) => m.role,
    );
    const hasSocial =
      needsPassword && (await this.identityRepo.count({ where: { user_id: user.id } })) > 0;
    const session = await this.authService.startSession(user, context);
    return {
      ...session,
      needs_password: needsPassword,
      password_required: needsPassword && audienceForRoles(roles) === 'staff' && !hasSocial,
    };
  }

  private async findUser(identifier: string): Promise<User | null> {
    return this.userRepo.findOne({
      where: [
        { email: identifier, deleted_at: IsNull() },
        { phone: identifier, deleted_at: IsNull() },
      ],
    });
  }

  /** ACTIVE, or an invited INACTIVE account that never set a password. SUSPENDED never. */
  private canSignInByCode(user: User): boolean {
    return (
      user.status === UserStatus.ACTIVE ||
      (user.status === UserStatus.INACTIVE && user.password_hash === null)
    );
  }

  /** A number without a leading `+` is local-format (the school's own country), so SMS is fine. */
  private smsAllowed(phone: string): boolean {
    if (!phone.startsWith('+')) return true;
    const prefixes = (this.config.get<string>('OTP_SMS_ALLOWED_PREFIXES') || DEFAULT_SMS_PREFIXES)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    return prefixes.some((p) => phone.startsWith(p));
  }

  /** Deny wins: OTP login is allowed only if every tenant this user belongs to has it enabled. */
  private async allowed(userId: string): Promise<boolean> {
    const memberships = await this.userTenantRepo.find({ where: { user_id: userId } });
    if (memberships.length === 0) return true;

    const settingsPerTenant = await Promise.all(
      memberships.map((m) => this.schoolsService.getResolvedSettings(m.tenant_id)),
    );
    return settingsPerTenant.every((settings) => settings.auth?.otpLoginEnabled !== false);
  }

  private echo(debug: { otp?: string }): OtpLoginRequestResult {
    return isSecretEchoEnabled(this.config) ? { debug } : {};
  }
}

function isEmail(identifier: string): boolean {
  return identifier.includes('@');
}
