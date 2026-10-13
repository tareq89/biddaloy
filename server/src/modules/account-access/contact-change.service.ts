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
import { RefreshTokenService, RequestContext } from '../auth/refresh-token.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { normalizeEmail, normalizeLoginIdentifier } from '../auth/normalize-identifier';
import { OTP_REDIS } from './otp.service';
import { OtpService } from './otp.service';
import { AuthTokenService, EMAIL_VERIFY_TTL_MS } from './auth-token.service';
import type { ContactField } from './account-access-templates';
import { AccountAccessDeliveryService, pickChannel } from './account-access-delivery.service';
import { isSecretEchoEnabled } from './account-access-echo';
import { resolveAppBaseUrl } from './app-base-url.util';

const OTP_PURPOSE = 'PHONE_VERIFY';
const PENDING_CHANGE_TTL_MS = 5 * 60_000;
/** [75.1] A person gets three days to approve a school's proposed contact change. */
const ADMIN_PROPOSAL_TTL_MS = 72 * 3_600_000;

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
    private readonly sessionCutoff: SessionCutoffService,
    private readonly refreshTokens: RefreshTokenService,
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

    // A user in no school must not get platform-paid SMS/email to an
    // address they choose (per-school/global OTP caps are #1759). A shared
    // user still passes: their messages are platform-sent by design (D28).
    if (!(await this.authService.hasLiveMembership(userId))) {
      throw new ForbiddenException('no_school');
    }
    const tenantId = await this.authService.primaryTenantId(userId, { throwOnError: true });

    if (dto.phone) {
      // Everything downstream — the uniqueness pre-check, the pending value
      // `confirmPhone` eventually writes to `users.phone`, and the OTP key —
      // uses the NORMALIZED form, never the raw submitted string. The DTO
      // accepts surrounding whitespace, and `OtpLoginService.verify` looks
      // users up by `normalizeLoginIdentifier(phone)`: storing the raw value
      // would create a row that sign-in can never match, and would let a
      // padded duplicate slip past the pre-check into the unique index.
      const normalized = normalizeLoginIdentifier(dto.phone);
      const existing = await this.userRepo.findOne({
        where: { phone: normalized },
        withDeleted: true,
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException('That phone number is already in use');
      }

      const { code } = await this.otpService.request(OTP_PURPOSE, normalized);
      const pending: PendingPhoneChange = { field: 'phone', value: normalized };
      await this.redis.set(
        this.redisKey(userId),
        JSON.stringify(pending),
        'PX',
        PENDING_CHANGE_TTL_MS,
      );

      await this.delivery.deliver({
        tenantId,
        medium: CommunicationMedium.SMS,
        to: normalized,
        recipientName: user.full_name,
        kind: 'OTP',
        vars: { code },
      });

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

    await this.delivery.deliver({
      tenantId,
      medium: CommunicationMedium.EMAIL,
      to: newEmail,
      recipientName: user.full_name,
      kind: 'EMAIL_VERIFY_LINK',
      vars: { link },
    });

    const echo = isSecretEchoEnabled(this.config);
    return { channel: 'link', ...(echo ? { debug: { token: raw } } : {}) };
  }

  /**
   * [75.1, D3/D23] A school admin asks to change the email/phone of a person who
   * also belongs to another school. Nothing is written to `users`: the person
   * gets a link at their CURRENT contact (never the proposed one) and the
   * other schools' admins get a notice that does not contain the new value.
   * `confirmEmail` applies it when the person opens the link.
   */
  async proposeByAdmin(
    input: {
      userId: string;
      tenantId: string;
      actorUserId: string;
      email?: string | null;
      phone?: string | null;
    },
    context: RequestContext,
  ): Promise<void> {
    const { userId, tenantId, actorUserId, email: newEmail, phone: newPhone } = input;
    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
    const field: ContactField =
      newEmail !== undefined && newPhone !== undefined
        ? 'both'
        : newEmail !== undefined
          ? 'email'
          : 'phone';

    // Approval goes to what the person has today: verified email, else verified phone, else any.
    const recipient =
      user.email && user.email_verified_at
        ? { medium: CommunicationMedium.EMAIL as const, to: user.email }
        : user.phone && user.phone_verified_at
          ? { medium: CommunicationMedium.SMS as const, to: user.phone }
          : user.email
            ? { medium: CommunicationMedium.EMAIL as const, to: user.email }
            : user.phone
              ? { medium: CommunicationMedium.SMS as const, to: user.phone }
              : null;
    if (!recipient) {
      throw new ConflictException({
        message: 'This person has no email or phone to approve the change from.',
        details: { code: 'NO_CONTACT' },
      });
    }

    // Same global-uniqueness pre-checks (and messages) as `request()`.
    if (newEmail) {
      const existing = await this.userRepo.findOne({
        where: { email: newEmail },
        withDeleted: true,
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException('That email address is already in use');
      }
    }
    if (newPhone) {
      const existing = await this.userRepo.findOne({
        where: { phone: newPhone },
        withDeleted: true,
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException('That phone number is already in use');
      }
    }

    // Latest request wins: `issue()` revokes this school's earlier live link.
    const { raw } = await this.authTokens.issue({
      userId,
      tenantId,
      purpose: AuthTokenPurpose.EMAIL_VERIFY,
      ttlMs: ADMIN_PROPOSAL_TTL_MS,
      createdByUserId: actorUserId,
      metadata: {
        kind: 'ADMIN_PROPOSAL',
        new_email: newEmail,
        new_phone: newPhone,
        proposed_in_tenant_id: tenantId,
      },
    });
    const link = `${resolveAppBaseUrl(this.config)}/verify-email?token=${encodeURIComponent(raw)}`;
    const manager = this.userRepo.manager;
    const [proposer] = await manager.query<Array<{ name: string }>>(
      'SELECT name FROM schools WHERE id = $1',
      [tenantId],
    );

    // tenantId null: the person is shared, so the platform sends it (D28), not one school.
    await this.delivery.deliver({
      tenantId: null,
      medium: recipient.medium,
      to: recipient.to,
      recipientName: user.full_name,
      kind: 'CONTACT_CHANGE_APPROVAL_LINK',
      vars: { link, from_school: proposer.name, field },
    });

    const admins = await manager.query<
      Array<{ tenant_id: string; email: string | null; phone: string | null; full_name: string }>
    >(
      `SELECT DISTINCT ut.tenant_id, u.email, u.phone, u.full_name
         FROM user_tenants ut JOIN users u ON u.id = ut.user_id
        WHERE ut.role = 'ADMIN' AND ut.deleted_at IS NULL AND u.deleted_at IS NULL
          AND ut.tenant_id IN (
            SELECT tenant_id FROM user_tenants
             WHERE user_id = $1 AND tenant_id <> $2 AND deleted_at IS NULL)`,
      [userId, tenantId],
    );
    for (const admin of admins) {
      const channel = pickChannel(admin);
      if (!channel) continue;
      await this.delivery.deliver({
        tenantId: admin.tenant_id,
        ...channel,
        recipientName: admin.full_name,
        kind: 'SHARED_CONTACT_CHANGE_NOTICE',
        // The new value is never in the notice.
        vars: { from_school: proposer.name, field, person: user.full_name },
      });
    }

    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'User',
      entity_id: userId,
      tenant_id: tenantId,
      performed_by_user_id: actorUserId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { operation: 'CONTACT_CHANGE_PROPOSED', field, proposed_by: actorUserId },
    });
  }

  /** [75.1] The person approved a school's proposal: write it (unverified), sign them out everywhere. */
  private async applyAdminProposal(
    tokenId: string,
    userId: string,
    tenantId: string | null,
    meta: { new_email?: string | null; new_phone?: string | null },
    context: RequestContext,
  ): Promise<{ status: string }> {
    await this.authTokens.consume(tokenId);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return { status: 'unknown' };

    // `undefined` = not part of the proposal; `null` = clear it. Like any admin edit, the new value starts unverified.
    const change: Partial<User> = {};
    if (meta.new_email !== undefined) {
      change.email = meta.new_email;
      change.email_verified_at = null;
    }
    if (meta.new_phone !== undefined) {
      change.phone = meta.new_phone;
      change.phone_verified_at = null;
    }
    try {
      await this.userRepo.update({ id: userId }, change);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        throw new ConflictException('That email address or phone number is already in use');
      }
      throw err;
    }
    await this.sessionCutoff.cutOff(userId);
    await this.refreshTokens.revokeAllForUser(userId);

    await this.auditService.record({
      action: AuditAction.CONTACT_VERIFIED,
      entity_type: 'User',
      entity_id: userId,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: {
        via: 'admin_proposal',
        old_email: user.email,
        old_phone: user.phone,
        ...(meta.new_email !== undefined ? { new_email: meta.new_email } : {}),
        ...(meta.new_phone !== undefined ? { new_phone: meta.new_phone } : {}),
      },
    });
    return { status: 'valid' };
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
    const meta = row.metadata as {
      kind?: string;
      new_email?: string | null;
      new_phone?: string | null;
    } | null;
    if (meta?.kind === 'ADMIN_PROPOSAL') {
      return this.applyAdminProposal(row.id, row.user_id, row.tenant_id, meta, context);
    }
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
