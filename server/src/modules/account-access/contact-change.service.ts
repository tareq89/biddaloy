import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import { AuditAction, AuthTokenPurpose, CommunicationMedium } from '@biddaloy/shared';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { RequestContext } from '../auth/refresh-token.service';
import { normalizeEmail, normalizeLoginIdentifier } from '../auth/normalize-identifier';
import { OTP_REDIS } from './otp.service';
import { OtpService } from './otp.service';
import { AuthTokenService, EMAIL_VERIFY_TTL_MS } from './auth-token.service';
import { AccountAccessDeliveryService } from './account-access-delivery.service';
import { isSecretEchoEnabled } from './account-access-echo';
import { resolveAppBaseUrl } from './app-base-url.util';

const OTP_PURPOSE = 'PHONE_VERIFY';
const PENDING_CHANGE_TTL_MS = 5 * 60_000;

interface PendingPhoneChange {
  field: 'phone';
  value: string;
}

export type ContactChangeRequestResult =
  { channel: 'otp'; debug?: { otp?: string } } | { channel: 'link'; debug?: { token?: string } };

/**
 * [12.7] The commit-on-verify flow for a user's own email/phone —
 * `PATCH /users/me` no longer accepts either field (see `UpdateOwnProfileDto`),
 * so this is the only way to change a contact for yourself. The OLD value
 * stays on the row until confirmation succeeds; nothing in `request()`
 * writes to `users`.
 */
@Injectable()
export class ContactChangeService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @Inject(OTP_REDIS) private readonly redis: Redis,
    private readonly otpService: OtpService,
    private readonly authTokens: AuthTokenService,
    private readonly delivery: AccountAccessDeliveryService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  private redisKey(userId: string): string {
    return `contact-change:${userId}`;
  }

  async request(
    userId: string,
    dto: { email?: string; phone?: string; current_password: string },
    context: RequestContext,
  ): Promise<ContactChangeRequestResult> {
    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });

    // A passwordless (OTP-only) user has nothing to prove possession with
    // here — the plan's deliberately simplified stance (no "fresh
    // OTP-login" nuance): their contact changes go through an admin.
    if (!user.password_hash) {
      throw new BadRequestException('no_password');
    }
    const valid = await bcrypt.compare(dto.current_password, user.password_hash);
    if (!valid) {
      // 403, not 401 — same reasoning as `UserService.updateOwnProfile`'s
      // old gate: a transparent-refresh client must not silently replay a
      // wrong password as a second attempt.
      throw new ForbiddenException('Current password is incorrect');
    }

    const tenantId = await this.authService.primaryTenantId(userId);

    if (dto.phone) {
      const normalized = normalizeLoginIdentifier(dto.phone);
      const existing = await this.userRepo.findOne({
        where: { phone: dto.phone },
        withDeleted: true,
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException('That phone number is already in use');
      }

      const { code } = await this.otpService.request(OTP_PURPOSE, normalized);
      const pending: PendingPhoneChange = { field: 'phone', value: dto.phone };
      await this.redis.set(
        this.redisKey(userId),
        JSON.stringify(pending),
        'PX',
        PENDING_CHANGE_TTL_MS,
      );

      if (tenantId) {
        await this.delivery.deliver({
          tenantId,
          medium: CommunicationMedium.SMS,
          to: dto.phone,
          recipientName: user.full_name,
          kind: 'OTP',
          vars: { code },
        });
      }

      const echo = isSecretEchoEnabled(this.config);
      return { channel: 'otp', ...(echo ? { debug: { otp: code } } : {}) };
    }

    // email branch
    const newEmail = normalizeEmail(dto.email as string);
    const existing = await this.userRepo.findOne({ where: { email: newEmail }, withDeleted: true });
    if (existing && existing.id !== userId) {
      throw new ConflictException('That email address is already in use');
    }

    const { raw } = await this.authTokens.issue({
      userId,
      tenantId,
      purpose: AuthTokenPurpose.EMAIL_VERIFY,
      ttlMs: EMAIL_VERIFY_TTL_MS,
      createdByUserId: userId,
      metadata: { new_email: newEmail },
    });
    const link = `${resolveAppBaseUrl(this.config)}/verify-email?token=${encodeURIComponent(raw)}`;

    if (tenantId) {
      await this.delivery.deliver({
        tenantId,
        medium: CommunicationMedium.EMAIL,
        to: newEmail,
        recipientName: user.full_name,
        kind: 'EMAIL_VERIFY_LINK',
        vars: { link },
      });
    }

    const echo = isSecretEchoEnabled(this.config);
    return { channel: 'link', ...(echo ? { debug: { token: raw } } : {}) };
  }

  async confirmPhone(userId: string, otp: string, context: RequestContext): Promise<void> {
    const raw = await this.redis.get(this.redisKey(userId));
    if (!raw) {
      throw new NotFoundException('No pending phone change found — request one first');
    }
    const pending = JSON.parse(raw) as PendingPhoneChange;
    const normalized = normalizeLoginIdentifier(pending.value);

    const result = await this.otpService.verify(OTP_PURPOSE, normalized, otp);
    if (result !== 'ok') {
      if (result === 'locked') {
        throw new ForbiddenException('Too many attempts — request a new code');
      }
      throw new BadRequestException('Invalid or expired code');
    }

    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
    const oldPhone = user.phone;

    try {
      await this.userRepo.update(
        { id: userId },
        { phone: pending.value, phone_verified_at: new Date() },
      );
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        throw new ConflictException('That phone number is already in use');
      }
      throw err;
    }
    await this.redis.del(this.redisKey(userId));

    const tenantId = await this.authService.primaryTenantId(userId);
    await this.auditService.record({
      action: AuditAction.CONTACT_VERIFIED,
      entity_type: 'User',
      entity_id: userId,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: {
        field: 'phone',
        via: 'contact_change',
        old_phone: oldPhone,
        new_phone: pending.value,
      },
    });
  }

  /** Public — the link is clicked from the inbox, possibly logged out. */
  async confirmEmail(rawToken: string, context: RequestContext): Promise<{ status: string }> {
    const result = await this.authTokens.verify(rawToken, AuthTokenPurpose.EMAIL_VERIFY);
    if (result.status !== 'valid') {
      return { status: result.status };
    }
    const { row } = result;
    const newEmail = (row.metadata as { new_email?: string } | null)?.new_email;
    if (!newEmail) {
      return { status: 'unknown' };
    }

    await this.authTokens.consume(row.id);

    const user = await this.userRepo.findOne({ where: { id: row.user_id } });
    if (!user) {
      return { status: 'unknown' };
    }
    const oldEmail = user.email;

    try {
      await this.userRepo.update(
        { id: user.id },
        { email: newEmail, email_verified_at: new Date() },
      );
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        throw new ConflictException('That email address is already in use');
      }
      throw err;
    }

    await this.auditService.record({
      action: AuditAction.CONTACT_VERIFIED,
      entity_type: 'User',
      entity_id: user.id,
      tenant_id: row.tenant_id,
      performed_by_user_id: user.id,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: {
        field: 'email',
        via: 'contact_change',
        old_email: oldEmail,
        new_email: newEmail,
      },
    });

    return { status: 'valid' };
  }
}
