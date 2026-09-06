import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuditAction, AuthTokenPurpose, CommunicationMedium, UserStatus } from '@biddaloy/shared';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuditService } from '../audit/audit.service';
import { AuthService, AuthResult } from '../auth/auth.service';
import { RefreshTokenService, RequestContext } from '../auth/refresh-token.service';
import { normalizeLoginIdentifier } from '../auth/normalize-identifier';
import { toLatinDigits } from '../../common/utils/bengali-digits.util';
import { OtpService } from './otp.service';
import { AuthTokenService, PASSWORD_RESET_TTL_MS } from './auth-token.service';
import { AccountAccessDeliveryService, pickChannel } from './account-access-delivery.service';
import { isSecretEchoEnabled } from './account-access-echo';
import { resolveAppBaseUrl } from './app-base-url.util';
import { ResetPasswordDto } from './dto/reset-password.dto';

const BCRYPT_COST = 10;
const OTP_PURPOSE = 'PASSWORD_RESET';

export interface ForgotPasswordResult {
  debug?: { otp?: string; token?: string };
}

export interface AdminResetResult {
  channel: 'SMS' | 'EMAIL';
  expires_at: Date;
}

/**
 * 12.3's `forgot-password` / `reset-password` machinery, built entirely out
 * of 12.1's `OtpService` (D3) and `AuthTokenService` (D2) plus
 * `AuthService.changePassword`'s tail (hash -> revoke -> reset lockouts ->
 * audit -> new session), copied rather than reused because that method is
 * shaped around "caller already knows their current password", which does
 * not apply here.
 */
@Injectable()
export class RecoveryService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    private readonly otpService: OtpService,
    private readonly authTokens: AuthTokenService,
    private readonly delivery: AccountAccessDeliveryService,
    private readonly authService: AuthService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Enumeration-safe: always resolves, never throws for "no such account" /
   * "not active" / delivery failure. D6's echo flag is the only way a test
   * can observe the OTP/token this issues.
   */
  async forgot(identifier: string, context: RequestContext): Promise<ForgotPasswordResult> {
    const normalized = normalizeLoginIdentifier(identifier);
    const user = await this.userRepo.findOne({
      where: [
        { email: normalized, deleted_at: IsNull() },
        { phone: normalized, deleted_at: IsNull() },
      ],
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      return {};
    }

    // Which field matched decides the channel (the plan's correction: an
    // email-shaped identifier gets a link, a phone-shaped one gets an OTP)
    // — not `pickChannel`'s email-first preference, which would silently
    // switch a phone-only forgot-password attempt into failure for a user
    // who also happens to have an email on file elsewhere in the flow.
    const matchedEmail = user.email === normalized;
    const tenantId = await this.authService.primaryTenantId(user.id);

    // [12.7] Recovery prefers a verified contact (D5 extension): if the
    // identifier that matched is itself unverified but the user's OTHER
    // contact is verified, send there instead — a stronger guarantee the
    // right person receives it. If the only contact on file is unverified,
    // still send to it: an unverified-only account would otherwise be
    // unrecoverable except by an admin reset, and this endpoint's whole
    // job is self-service recovery. The response is 202 either way.
    if (!matchedEmail) {
      // Phone matched.
      if (!user.phone) return {};
      if (!user.phone_verified_at && user.email && user.email_verified_at) {
        return this.sendLink(user, user.email, tenantId, null);
      }
      return this.sendOtp(user, user.phone, tenantId);
    }

    if (!user.email) return {};
    if (!user.email_verified_at && user.phone && user.phone_verified_at) {
      return this.sendOtp(user, user.phone, tenantId);
    }
    return this.sendLink(user, user.email, tenantId, null);
  }

  /**
   * OTP branch (`{ phone, otp }`) or link branch (`{ token }`) — exactly one
   * is present, enforced by `ResetPasswordDto`'s validator. Both converge on
   * the same tail: hash, revoke every refresh token, clear login lockouts,
   * audit, and sign the caller in immediately.
   */
  async reset(dto: ResetPasswordDto, context: RequestContext): Promise<AuthResult> {
    let user: User;
    let method: 'otp' | 'link';

    if (dto.token) {
      const result = await this.authTokens.verify(dto.token, AuthTokenPurpose.PASSWORD_RESET);
      if (result.status !== 'valid') {
        throw new UnauthorizedException('Invalid or expired link');
      }
      const found = await this.userRepo.findOne({ where: { id: result.row.user_id } });
      if (!found) {
        throw new UnauthorizedException('Invalid or expired link');
      }
      await this.authTokens.consume(result.row.id);

      // [12.7] The token proves control of the email it was SENT to, not
      // "this user, whatever their email is now" — `sendLink` stamps that
      // fingerprint into `metadata.email`. If it no longer matches the
      // account's current email, either the account's email changed since
      // (an admin edit, or the owner's own contact-change flow) or this link
      // was never bound to begin with (pre-12.7 token). Either way, honoring
      // it would let whoever received the OLD link reset the password of an
      // account now identified by a DIFFERENT address — the same class of
      // gap ActivationService.activate closes for invites. A pre-12.7 token
      // has no fingerprint to compare, so it is refused rather than trusted.
      const sentTo = (result.row.metadata as { email?: string } | null)?.email;
      if (!sentTo || !found.email || normalizeLoginIdentifier(found.email) !== sentTo) {
        throw new UnauthorizedException('Invalid or expired link');
      }

      user = found;
      method = 'link';
    } else {
      const phone = toLatinDigits((dto.phone ?? '').trim());
      const identifier = normalizeLoginIdentifier(phone);
      const verifyResult = await this.otpService.verify(OTP_PURPOSE, identifier, dto.otp ?? '');
      if (verifyResult === 'locked') {
        throw new HttpException(
          { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many attempts' },
          HttpStatus.TOO_MANY_REQUESTS,
          { description: 'Retry-After: 900' },
        );
      }
      if (verifyResult !== 'ok') {
        throw new UnauthorizedException('Invalid or expired code');
      }
      const found = await this.userRepo.findOne({ where: { phone, deleted_at: IsNull() } });
      if (!found) {
        throw new UnauthorizedException('Invalid or expired code');
      }
      user = found;
      method = 'otp';
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(
        method === 'link' ? 'Invalid or expired link' : 'Invalid or expired code',
      );
    }

    await this.applyNewPassword(user, dto.new_password, context, {
      action: AuditAction.PASSWORD_RESET,
      performedByUserId: user.id,
      newValues: { method },
    });

    // [12.7] Completing a reset proves control of whichever contact carried
    // it: the OTP branch proves the phone, the link branch proves the
    // email. Stamp once, never overwrite an existing verification.
    //
    // Compare-and-set, not a bare update by id: an admin edit landing between
    // the read above and this write would otherwise let a reset completed
    // against the OLD contact mark the REPLACEMENT contact verified — a
    // contact nobody has proven control of. Matching the contact value (and
    // `IS NULL` on the timestamp, which also makes a concurrent double-stamp
    // a no-op) means the write only lands on the row this reset actually
    // proved, and `affected` tells us whether it did.
    const verifiedField: 'email' | 'phone' = method === 'link' ? 'email' : 'phone';
    const alreadyVerified =
      verifiedField === 'email' ? user.email_verified_at !== null : user.phone_verified_at !== null;
    const verifiedContact = verifiedField === 'email' ? user.email : user.phone;
    if (!alreadyVerified && verifiedContact) {
      const stamp = await this.userRepo.update(
        verifiedField === 'email'
          ? { id: user.id, email: verifiedContact, email_verified_at: IsNull() }
          : { id: user.id, phone: verifiedContact, phone_verified_at: IsNull() },
        verifiedField === 'email'
          ? { email_verified_at: new Date() }
          : { phone_verified_at: new Date() },
      );
      // Only audit a verification that actually happened.
      if (stamp.affected === 1) {
        await this.auditService.record({
          action: AuditAction.CONTACT_VERIFIED,
          entity_type: 'User',
          entity_id: user.id,
          tenant_id: await this.authService.primaryTenantId(user.id),
          performed_by_user_id: user.id,
          ip_address: context.ip,
          user_agent: context.userAgent,
          new_values: { field: verifiedField, via: 'password_reset' },
        });
      }
    }

    return this.authService.startSession(user, context);
  }

  /**
   * Admin-initiated reset (#396's server half). The caller is responsible
   * for verifying `user` actually belongs to `tenantId` before calling this
   * (`UserService.findOne` already does that, 404ing otherwise) — this
   * method does not repeat that check.
   */
  async adminReset(input: {
    user: User;
    tenantId: string;
    actorUserId: string;
    context: RequestContext;
  }): Promise<AdminResetResult> {
    const { user, tenantId, actorUserId, context } = input;

    // Belt-and-suspenders: `UserController.resetPassword` already resolves
    // `user` via `UserService.findOne(id, tenantId)`, which 404s on a
    // cross-tenant target — this repeats the check at the service boundary
    // so `adminReset` is safe to call from anywhere, not just that one route.
    const membership = await this.userTenantRepo.findOne({
      where: { user_id: user.id, tenant_id: tenantId },
    });
    if (!membership) {
      throw new NotFoundException(`User with ID "${user.id}" not found`);
    }

    const channel = pickChannel(user);
    if (!channel) {
      throw new HttpException(
        'This user has no email or phone on file to receive a reset',
        HttpStatus.BAD_REQUEST,
      );
    }

    // The target's sessions die immediately — an admin resetting a password
    // must not leave a stolen/compromised session alive while the OTP/link
    // is in flight.
    await this.refreshTokens.revokeAllForUser(user.id);

    let expires_at: Date;
    if (channel.medium === CommunicationMedium.SMS) {
      const { code } = await this.otpService.request(
        OTP_PURPOSE,
        normalizeLoginIdentifier(channel.to),
      );
      await this.delivery.deliver({
        tenantId,
        medium: CommunicationMedium.SMS,
        to: channel.to,
        recipientName: user.full_name,
        kind: 'OTP',
        vars: { code },
      });
      expires_at = new Date(Date.now() + 5 * 60_000);
    } else {
      const { raw, row } = await this.authTokens.issue({
        userId: user.id,
        tenantId,
        purpose: AuthTokenPurpose.PASSWORD_RESET,
        ttlMs: PASSWORD_RESET_TTL_MS,
        createdByUserId: actorUserId,
      });
      const link = this.buildResetLink(raw);
      await this.delivery.deliver({
        tenantId,
        medium: CommunicationMedium.EMAIL,
        to: channel.to,
        recipientName: user.full_name,
        kind: 'PASSWORD_RESET_LINK',
        vars: { link },
      });
      expires_at = row.expires_at;
    }

    await this.auditService.record({
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      entity_type: 'User',
      entity_id: user.id,
      tenant_id: tenantId,
      performed_by_user_id: actorUserId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { channel: channel.medium, admin_initiated: true },
    });

    return { channel: channel.medium, expires_at };
  }

  private async sendOtp(
    user: User,
    phone: string,
    tenantId: string | null,
  ): Promise<ForgotPasswordResult> {
    if (!tenantId) return {};
    let code: string;
    try {
      ({ code } = await this.otpService.request(OTP_PURPOSE, normalizeLoginIdentifier(phone)));
    } catch {
      // A 429 from the cooldown must not leak beyond the same 202 every
      // other branch returns — an attacker probing for "already has a
      // pending OTP" is exactly the timing signal this endpoint exists to
      // deny.
      await this.auditRequested(user, tenantId, CommunicationMedium.SMS);
      return this.echo({});
    }

    await this.delivery.deliver({
      tenantId,
      medium: CommunicationMedium.SMS,
      to: phone,
      recipientName: user.full_name,
      kind: 'OTP',
      vars: { code },
    });
    await this.auditRequested(user, tenantId, CommunicationMedium.SMS);
    return this.echo({ otp: code });
  }

  private async sendLink(
    user: User,
    email: string,
    tenantId: string | null,
    _unused: null,
  ): Promise<ForgotPasswordResult> {
    if (!tenantId) return {};
    const { raw } = await this.authTokens.issue({
      userId: user.id,
      tenantId,
      purpose: AuthTokenPurpose.PASSWORD_RESET,
      ttlMs: PASSWORD_RESET_TTL_MS,
      // [12.7] The token authenticates "this user", not "this email" — bind
      // it to the address it was actually delivered to. `reset()`'s link
      // branch requires this fingerprint to still match before honoring the
      // link, so an email changed after the link went out (whether by the
      // user's own contact-change flow or an admin edit) can't be reset by
      // whoever is holding the OLD address, and can't mark the REPLACEMENT
      // address verified either.
      metadata: { email: normalizeLoginIdentifier(email) },
    });
    const link = this.buildResetLink(raw);

    await this.delivery.deliver({
      tenantId,
      medium: CommunicationMedium.EMAIL,
      to: email,
      recipientName: user.full_name,
      kind: 'PASSWORD_RESET_LINK',
      vars: { link },
    });
    await this.auditRequested(user, tenantId, CommunicationMedium.EMAIL);
    return this.echo({ token: raw });
  }

  private async auditRequested(
    user: User,
    tenantId: string,
    channel: (typeof CommunicationMedium)[keyof typeof CommunicationMedium],
  ): Promise<void> {
    // Never the identifier text — unlike LOGIN_FAILED's `new_values:
    // { identifier }`, a reset *request* is not a failure being
    // investigated; it's routine, and the identifier is PII the audit log
    // does not need to do its job.
    await this.auditService.record({
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      entity_type: 'User',
      entity_id: user.id,
      tenant_id: tenantId,
      performed_by_user_id: user.id,
      ip_address: null,
      user_agent: null,
      new_values: { channel },
    });
  }

  private echo(debug: { otp?: string; token?: string }): ForgotPasswordResult {
    return isSecretEchoEnabled(this.config) ? { debug } : {};
  }

  private buildResetLink(rawToken: string): string {
    const base = resolveAppBaseUrl(this.config);
    return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
  }

  /** `changePassword`'s tail (auth.service.ts), copied rather than reused — see this file's class doc. */
  private async applyNewPassword(
    user: User,
    newPassword: string,
    context: RequestContext,
    audit: { action: AuditAction; performedByUserId: string; newValues: Record<string, unknown> },
  ): Promise<void> {
    const password_hash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.userRepo.update({ id: user.id }, { password_hash });

    await this.refreshTokens.revokeAllForUser(user.id);
    await this.authService.resetLoginLockouts(user);

    await this.auditService.record({
      action: audit.action,
      entity_type: 'User',
      entity_id: user.id,
      tenant_id: await this.authService.primaryTenantId(user.id),
      performed_by_user_id: audit.performedByUserId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: audit.newValues,
    });
  }
}
