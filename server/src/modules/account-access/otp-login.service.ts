import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AuditAction, CommunicationMedium, UserStatus } from '@biddaloy/shared';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuditService } from '../audit/audit.service';
import { AuthService, AuthResult } from '../auth/auth.service';
import { LoginAttemptService } from '../auth/login-attempt.service';
import { RequestContext } from '../auth/refresh-token.service';
import { normalizeLoginIdentifier } from '../auth/normalize-identifier';
import { SchoolsService } from '../schools/schools.service';
import { OtpService } from './otp.service';
import { AccountAccessDeliveryService } from './account-access-delivery.service';
import { isSecretEchoEnabled } from './account-access-echo';

const OTP_PURPOSE = 'LOGIN';

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
  async request(phone: string, context: RequestContext): Promise<OtpLoginRequestResult> {
    const identifier = normalizeLoginIdentifier(phone);
    const user = await this.userRepo.findOne({ where: { phone: identifier } });

    if (!user || user.status !== UserStatus.ACTIVE || !(await this.allowed(user.id))) {
      return {};
    }

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
      medium: CommunicationMedium.SMS,
      to: user.phone as string,
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
  async verify(phone: string, otp: string, context: RequestContext): Promise<AuthResult> {
    const identifier = normalizeLoginIdentifier(phone);
    const result = await this.otpService.verify(OTP_PURPOSE, identifier, otp);

    if (result === 'locked') {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many attempts' },
        HttpStatus.TOO_MANY_REQUESTS,
        { description: 'Retry-After: 900' },
      );
    }

    const user = await this.userRepo.findOne({ where: { phone: identifier } });
    const success =
      result === 'ok' &&
      !!user &&
      user.status === UserStatus.ACTIVE &&
      (await this.allowed(user.id));

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

    // [12.7] A successful OTP verify proves the caller controls this phone
    // — stamp it, but only the first time (never overwrite an existing
    // verification timestamp with a later one).
    const alreadyVerified = user.phone_verified_at !== null;
    await this.userRepo.update(
      { id: user.id },
      { last_login_at: new Date(), ...(alreadyVerified ? {} : { phone_verified_at: new Date() }) },
    );

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

    if (!alreadyVerified) {
      await this.auditService.record({
        action: AuditAction.CONTACT_VERIFIED,
        entity_type: 'User',
        entity_id: user.id,
        tenant_id: tenantId,
        performed_by_user_id: user.id,
        ip_address: context.ip,
        user_agent: context.userAgent,
        new_values: { field: 'phone', via: 'otp_login' },
      });
    }

    return this.authService.startSession(user, context);
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
