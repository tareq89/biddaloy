import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import {
  AuditAction,
  AuthTokenPurpose,
  CommunicationMedium,
  CommunicationStatus,
} from '@biddaloy/shared';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { RefreshTokenService, RequestContext } from '../auth/refresh-token.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { TenantStatusService } from '../schools/tenant-status.service';
import { normalizeEmail, normalizeLoginIdentifier } from '../auth/normalize-identifier';
import { OTP_REDIS } from './otp.service';
import { OtpService, type OtpPurpose } from './otp.service';
import { AuthTokenService, EMAIL_VERIFY_TTL_MS } from './auth-token.service';
import type { AuthToken } from './entities/auth-token.entity';
import type { ContactField } from './account-access-templates';
import { maskEmail, maskPhone } from './contact-mask.util';
import { AccountAccessDeliveryService, pickChannel } from './account-access-delivery.service';
import { isSecretEchoEnabled } from './account-access-echo';
import { resolveAppBaseUrl } from './app-base-url.util';

const OTP_PURPOSE = 'PHONE_VERIFY';
const PENDING_CHANGE_TTL_MS = 5 * 60_000;
/** [75.1] A person gets three days to approve a school's proposed contact change. */
const ADMIN_PROPOSAL_TTL_MS = 72 * 3_600_000;
/** D23: the code that proves a proposed NEW contact; phone shares the self-service purpose. */
const NEW_CONTACT_OTP = { email: 'EMAIL_VERIFY', phone: 'PHONE_VERIFY' } as const satisfies Record<
  'email' | 'phone',
  OtpPurpose
>;

interface PendingPhoneChange {
  field: 'phone';
  value: string;
}

/** What an ADMIN_PROPOSAL token stores in `auth_tokens.metadata`. */
interface AdminProposalMeta {
  kind?: string;
  new_email?: string | null;
  new_phone?: string | null;
  proposed_in_tenant_id?: string;
  sent_to?: { medium: string; address: string };
  /** Review R1: stamped once the approval link was really delivered. */
  sent?: boolean;
}

export interface ConfirmEmailResult {
  status: string;
  /** Only for status 'proposal': what the school asks for, values MASKED (null = remove it). */
  proposal?: { from_school: string; new_email?: string | null; new_phone?: string | null };
  /** Echo-only (D6), status 'confirm': the codes sent to the new contact(s). */
  debug?: { email_code?: string; phone_code?: string };
}

/** D23: codes the person typed from the NEW contact(s), sent with action 'approve'. */
export interface NewContactCodes {
  email_code?: string;
  phone_code?: string;
}

function fieldOf(email: string | null | undefined, phone: string | null | undefined): ContactField {
  return email !== undefined && phone !== undefined
    ? 'both'
    : email !== undefined
      ? 'email'
      : 'phone';
}

/** The proposed value(s) for the approval message, masked; `(removed)` when a contact is cleared. */
function maskedNewValue(
  email: string | null | undefined,
  phone: string | null | undefined,
): string {
  const parts: string[] = [];
  if (email !== undefined) parts.push(email ? maskEmail(email) : '(removed)');
  if (phone !== undefined) parts.push(phone ? maskPhone(phone) : '(removed)');
  return parts.join(' / ');
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
  private readonly logger = new Logger(ContactChangeService.name);

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
    private readonly tenantStatus: TenantStatusService,
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
   * [75.1] The checks that can reject a proposal (NO_CONTACT, value already taken), with no side
   * effects. The controller runs this BEFORE saving the other fields, so a rejected change writes nothing.
   */
  async assertCanPropose(
    userId: string,
    newEmail: string | null | undefined,
    newPhone: string | null | undefined,
  ) {
    const user = await this.userRepo.findOneOrFail({ where: { id: userId } });
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
    return { user, recipient };
  }

  /**
   * [75.1, D3/D23] A school admin asks to change the email/phone of a person who
   * also belongs to another school. Nothing is written to `users`: the person
   * gets a link at their CURRENT contact (never the proposed one) that shows
   * the MASKED new value; the other schools' admins get a notice without it.
   * The link only opens a page: the person must press Approve (`confirmEmail`
   * with action 'approve') or Decline. D23: Approve then sends a code to each
   * NEW value, and nothing is written until those codes come back.
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
    const { user, recipient } = await this.assertCanPropose(userId, newEmail, newPhone);
    const field = fieldOf(newEmail, newPhone);

    // Re-saving the form with the same pending change sends nothing again (review m2): the live link
    // stands. Only a link that was really delivered counts (review R1), so a re-save after a failed
    // send always sends again. Only the same admin's link counts (review m-new-5): approval checks
    // the proposer, so another admin's re-save gets its own link and `issue()` revokes the old one.
    const [live] = await this.userRepo.manager.query<Array<{ metadata: AdminProposalMeta }>>(
      `SELECT metadata FROM auth_tokens
        WHERE user_id = $1 AND tenant_id = $2 AND purpose = $3 AND created_by_user_id = $4
          AND metadata->>'kind' = 'ADMIN_PROPOSAL' AND metadata->>'sent' = 'true'
          AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()`,
      [userId, tenantId, AuthTokenPurpose.EMAIL_VERIFY, actorUserId],
    );
    if (
      live &&
      live.metadata.new_email === newEmail &&
      live.metadata.new_phone === newPhone &&
      live.metadata.sent_to?.medium === recipient.medium &&
      live.metadata.sent_to?.address === recipient.to
    ) {
      return;
    }

    // Latest request from this school wins (`issue()` revokes its earlier ADMIN_PROPOSAL link only).
    const { raw, row } = await this.authTokens.issue({
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
        // Where the link went: at approval it must still be the person's contact (else stale).
        sent_to: { medium: recipient.medium, address: recipient.to },
      },
    });
    // Review m7: if anything below throws, revoke the link so no live proposal outlives a failed
    // send (a retry would otherwise look like a duplicate and send nothing).
    try {
      const link = `${resolveAppBaseUrl(this.config)}/verify-email?token=${encodeURIComponent(raw)}`;
      const manager = this.userRepo.manager;
      const [proposer] = await manager.query<Array<{ name: string }>>(
        'SELECT name FROM schools WHERE id = $1',
        [tenantId],
      );

      // tenantId null: the person is shared, so the platform sends it (D28), not one school.
      // (communication_logs.tenant_id is NOT NULL, so the record of this send is the audit row below.)
      const delivered = await this.delivery.deliver({
        tenantId: null,
        medium: recipient.medium,
        to: recipient.to,
        recipientName: user.full_name,
        kind: 'CONTACT_CHANGE_APPROVAL_LINK',
        vars: {
          link,
          from_school: proposer.name,
          field,
          new_value: maskedNewValue(newEmail, newPhone),
        },
      });
      // Review R1: deliver() reports a gateway failure as FAILED; it never throws.
      if (delivered.status !== CommunicationStatus.SENT) {
        throw new Error('approval link not delivered');
      }
      await manager.query(
        `UPDATE auth_tokens SET metadata = metadata || '{"sent": true}'::jsonb WHERE id = $1`,
        [row.id],
      );

      const admins = await manager.query<
        Array<{ tenant_id: string; email: string | null; phone: string | null; full_name: string }>
      >(
        `SELECT DISTINCT ut.tenant_id, u.email, u.phone, u.full_name
           FROM user_tenants ut JOIN users u ON u.id = ut.user_id
          WHERE ut.role = 'ADMIN' AND ut.deleted_at IS NULL
            AND u.deleted_at IS NULL AND u.status = 'ACTIVE' AND u.id <> $1
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
        new_values: {
          operation: 'CONTACT_CHANGE_PROPOSED',
          field,
          proposed_by: actorUserId,
          sent_via: recipient.medium,
          sent_to_masked:
            recipient.medium === CommunicationMedium.EMAIL
              ? maskEmail(recipient.to)
              : maskPhone(recipient.to),
        },
      });
    } catch (err) {
      // Review n-new-2: the reason only, never the link, a code or a body.
      this.logger.warn(
        `contact-change proposal ${row.id} not sent, revoking: ${(err as Error).message}`,
      );
      try {
        await this.authTokens.revoke(row.id);
      } catch (revokeErr) {
        // The link stays live but unstamped, so the dedupe still lets a re-save send a fresh one.
        this.logger.error(
          `contact-change proposal ${row.id} could not be revoked: ${(revokeErr as Error).message}`,
        );
      }
      throw new ServiceUnavailableException(
        'The approval request could not be sent, so the email/phone change is not pending. Try again.',
      );
    }
  }

  /** Still the contact the link was sent to? Else the proposal is stale. */
  private sentToStillCurrent(
    user: Pick<User, 'email' | 'phone'>,
    meta: AdminProposalMeta,
  ): boolean {
    const sent = meta.sent_to;
    if (!sent) return false;
    return sent.medium === CommunicationMedium.EMAIL
      ? user.email === sent.address
      : user.phone === sent.address;
  }

  /**
   * Review m8: the asking school still has the person, and whoever asked is still an active
   * ADMIN there. Otherwise a school the person left could still change their login for 72 h.
   * Review m-new-1: a platform SUPER_ADMIN (SUPER_ADMIN on the platform tenant, the same rule as
   * ContextGuard's `isPlatformSuperAdmin`) has no ADMIN row in the school but may also propose.
   */
  private async proposalStillBacked(
    manager: EntityManager,
    userId: string,
    proposerId: string | null,
    meta: AdminProposalMeta,
  ): Promise<boolean> {
    if (!proposerId || !meta.proposed_in_tenant_id) return false;
    const platformTenantId = (await this.tenantStatus.platformTenantId()) ?? null;
    const [row] = await manager.query<Array<{ ok: boolean }>>(
      // FOR SHARE (review n-new-3): inside the approval transaction, a removal or demotion that is
      // mid-commit is waited for and then seen, instead of read as its old, still-live version.
      `SELECT EXISTS (SELECT 1 FROM user_tenants
                       WHERE user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR SHARE)
          AND EXISTS (SELECT 1 FROM user_tenants ut JOIN users u ON u.id = ut.user_id
                       WHERE ut.user_id = $3
                         AND ((ut.tenant_id = $2 AND ut.role = 'ADMIN')
                           OR (ut.tenant_id = $4 AND ut.role = 'SUPER_ADMIN'))
                         AND ut.deleted_at IS NULL AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
                       FOR SHARE OF ut) AS ok`,
      [userId, meta.proposed_in_tenant_id, proposerId, platformTenantId],
    );
    return row.ok;
  }

  /**
   * Can this proposal still be applied to `user` as it is now? 'valid', or why not. Throws the
   * 409s for a change that is no longer possible (no identifier left, value taken meanwhile).
   */
  private async proposalOutcome(
    manager: EntityManager,
    user: User | null,
    token: AuthToken,
    meta: AdminProposalMeta,
  ): Promise<'valid' | 'unknown' | 'revoked' | 'withdrawn'> {
    if (!user) return 'unknown';
    if (!this.sentToStillCurrent(user, meta)) return 'revoked';
    if (!(await this.proposalStillBacked(manager, user.id, token.created_by_user_id, meta))) {
      return 'withdrawn';
    }
    // Re-check against the CURRENT state: another approval or a self-service change may have landed.
    const nextEmail = meta.new_email !== undefined ? meta.new_email : user.email;
    const nextPhone = meta.new_phone !== undefined ? meta.new_phone : user.phone;
    if (!nextEmail && !nextPhone) {
      throw new ConflictException({
        message: 'This change would leave the account with no email or phone.',
        details: { code: 'LAST_IDENTIFIER' },
      });
    }
    const clash = await manager
      .getRepository(User)
      .createQueryBuilder('u')
      .withDeleted()
      .where('u.id <> :id AND (u.email = :email OR u.phone = :phone)', {
        id: user.id,
        email: meta.new_email ?? '',
        phone: meta.new_phone ?? '',
      })
      .getCount();
    if (clash > 0) {
      throw new ConflictException('That email address or phone number is already in use');
    }
    return 'valid';
  }

  /** A proposal that can't be applied: a withdrawn one is revoked and refused (409), the rest just reported. */
  private async refuse(
    outcome: 'unknown' | 'revoked' | 'withdrawn',
    tokenId: string,
  ): Promise<ConfirmEmailResult> {
    if (outcome !== 'withdrawn') return { status: outcome };
    await this.authTokens.revoke(tokenId);
    throw new ConflictException({
      message:
        'The school that asked for this change no longer has you as a member, or the person who asked is no longer its admin.',
      details: { code: 'PROPOSAL_WITHDRAWN' },
    });
  }

  /**
   * [75.1] The person pressed Approve. D23: approving is consent from the CURRENT contact; each
   * NEW email/phone must then prove it is theirs with a code sent to it (the self-service
   * contact-change OTP), entered on the same page. Nothing is written until every code checks
   * out, so an unconfirmed value is never a login. A removal (null) needs no code.
   * One transaction for the write, token consumed last.
   */
  private async approveAdminProposal(
    token: AuthToken,
    meta: AdminProposalMeta,
    context: RequestContext,
    codes: NewContactCodes,
  ): Promise<ConfirmEmailResult> {
    const { id: tokenId, user_id: userId, tenant_id: tenantId } = token;
    const toProve = (['email', 'phone'] as const).flatMap((field) => {
      const value = field === 'email' ? meta.new_email : meta.new_phone;
      return value ? [{ field, value, code: codes[`${field}_code`] }] : [];
    });

    if (toProve.some((p) => !p.code)) {
      // Check first, so a proposal that can no longer apply sends nothing.
      const user = await this.userRepo.findOne({ where: { id: userId } });
      const outcome = await this.proposalOutcome(this.userRepo.manager, user, token, meta);
      if (outcome !== 'valid') return this.refuse(outcome, tokenId);
      const sent: NewContactCodes = {};
      for (const { field, value } of toProve) {
        // Bound to this link: a code sent for another proposal or flow never confirms this one.
        const { code } = await this.otpService.request(NEW_CONTACT_OTP[field], value, tokenId);
        const delivered = await this.delivery.deliver({
          tenantId: null,
          medium: field === 'email' ? CommunicationMedium.EMAIL : CommunicationMedium.SMS,
          to: value,
          recipientName: user!.full_name,
          kind: 'OTP',
          vars: { code },
        });
        // Review R1: never answer 'confirm' for a code that did not go out. The link stays
        // usable; pressing Approve again (after the 60 s cooldown) re-sends.
        if (delivered.status !== CommunicationStatus.SENT) {
          throw new ServiceUnavailableException(
            'The code could not be sent to the new contact. Try again in a minute.',
          );
        }
        sent[`${field}_code`] = code;
      }
      return { status: 'confirm', ...(isSecretEchoEnabled(this.config) ? { debug: sent } : {}) };
    }

    // ponytail: codes are checked one by one, so a right email code with a wrong phone code
    // spends the email code too; the person presses Approve again for fresh ones.
    for (const { field, value, code } of toProve) {
      const result = await this.otpService.verify(NEW_CONTACT_OTP[field], value, code!, tokenId);
      if (result === 'locked')
        throw new ForbiddenException('Too many attempts — request a new code');
      if (result !== 'ok') throw new BadRequestException('Invalid or expired code');
    }

    const outcome = await this.userRepo.manager.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .findOne({ where: { id: userId }, lock: { mode: 'pessimistic_write' } });
      const check = await this.proposalOutcome(manager, user, token, meta);
      if (check !== 'valid' || !user) return check;

      // `undefined` = not part of the proposal; `null` = clear it. A new value was just proven by its code.
      const now = new Date();
      const change: Partial<User> = {};
      if (meta.new_email !== undefined) {
        change.email = meta.new_email;
        change.email_verified_at = meta.new_email ? now : null;
      }
      if (meta.new_phone !== undefined) {
        change.phone = meta.new_phone;
        change.phone_verified_at = meta.new_phone ? now : null;
      }
      try {
        await manager.getRepository(User).update({ id: userId }, change);
      } catch (err) {
        // Another user took the value after the check above: 409, and the rollback keeps the link.
        if (
          err instanceof QueryFailedError &&
          (err as unknown as { code?: string }).code === '23505'
        ) {
          throw new ConflictException('That email address or phone number is already in use');
        }
        throw err;
      }
      // Last: a conflict above rolls back and leaves the link usable.
      await this.authTokens.consume(tokenId, manager);
      await this.auditService.record(
        {
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
        },
        manager,
      );
      return 'valid' as const;
    });
    if (outcome !== 'valid') return this.refuse(outcome, tokenId);

    // After commit, from the app clock (see SessionCutoffService). Revoke first: a refresh
    // that rotates before the revoke then mints a token older than the cut-off.
    await this.refreshTokens.revokeAllForUser(userId);
    await this.sessionCutoff.cutOff(userId);
    return { status: 'valid' };
  }

  /** [75.1] The person pressed Decline: the proposal is cancelled and the asking school is told. */
  private async declineAdminProposal(
    tokenId: string,
    userId: string,
    meta: AdminProposalMeta,
    context: RequestContext,
  ): Promise<{ status: string }> {
    await this.authTokens.consume(tokenId);
    const askingTenant = meta.proposed_in_tenant_id;
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !askingTenant) return { status: 'declined' };
    const field = fieldOf(meta.new_email, meta.new_phone);
    const admins = await this.userRepo.manager.query<
      Array<{ email: string | null; phone: string | null; full_name: string }>
    >(
      `SELECT DISTINCT u.email, u.phone, u.full_name
         FROM user_tenants ut JOIN users u ON u.id = ut.user_id
        WHERE ut.role = 'ADMIN' AND ut.tenant_id = $1 AND ut.deleted_at IS NULL
          AND u.deleted_at IS NULL AND u.status = 'ACTIVE' AND u.id <> $2`,
      [askingTenant, userId],
    );
    for (const admin of admins) {
      const channel = pickChannel(admin);
      if (!channel) continue;
      await this.delivery.deliver({
        tenantId: askingTenant,
        ...channel,
        recipientName: admin.full_name,
        kind: 'CONTACT_CHANGE_DECLINED_NOTICE',
        vars: { field, person: user.full_name },
      });
    }
    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'User',
      entity_id: userId,
      tenant_id: askingTenant,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { operation: 'CONTACT_CHANGE_DECLINED', field },
    });
    return { status: 'declined' };
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
  async confirmEmail(
    rawToken: string,
    context: RequestContext,
    action?: 'approve' | 'decline',
    codes: NewContactCodes = {},
  ): Promise<ConfirmEmailResult> {
    const result = await this.authTokens.verify(rawToken, AuthTokenPurpose.EMAIL_VERIFY);
    if (result.status !== 'valid') {
      return { status: result.status };
    }
    const { row } = result;
    const meta = row.metadata as AdminProposalMeta | null;
    if (meta?.kind === 'ADMIN_PROPOSAL') {
      // Opening the link never changes anything: the person must press Approve or Decline.
      if (action === 'approve') {
        return this.approveAdminProposal(row, meta, context, codes);
      }
      if (action === 'decline') {
        return this.declineAdminProposal(row.id, row.user_id, meta, context);
      }
      const owner = await this.userRepo.findOne({ where: { id: row.user_id } });
      if (!owner || !this.sentToStillCurrent(owner, meta)) return { status: 'revoked' };
      const [school] = await this.userRepo.manager.query<Array<{ name: string }>>(
        'SELECT name FROM schools WHERE id = $1',
        [meta.proposed_in_tenant_id],
      );
      return {
        status: 'proposal',
        proposal: {
          from_school: school?.name ?? '',
          ...(meta.new_email !== undefined
            ? { new_email: meta.new_email ? maskEmail(meta.new_email) : null }
            : {}),
          ...(meta.new_phone !== undefined
            ? { new_phone: meta.new_phone ? maskPhone(meta.new_phone) : null }
            : {}),
        },
      };
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
