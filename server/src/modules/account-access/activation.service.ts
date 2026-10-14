import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { hashPassword } from '../auth/password-hash';
import { AuditAction, AuthTokenPurpose, UserStatus, audienceForRoles } from '@biddaloy/shared';
import type { PasswordAudience } from '@biddaloy/shared';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { assertPasswordAllowedForUser } from '../auth/password-policy';
import { School } from '../schools/entities/school.entity';
import { AuditService } from '../audit/audit.service';
import { AccountAccessDeliveryService } from './account-access-delivery.service';
import { AuthService, AuthResult } from '../auth/auth.service';
import { RefreshTokenService, RequestContext } from '../auth/refresh-token.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { normalizeLoginIdentifier } from '../auth/normalize-identifier';
import { AuthTokenService } from './auth-token.service';
import { InvitationService } from './invitation.service';

export type ActivateVerifyResult =
  | {
      status: 'valid';
      full_name: string;
      school_name: string | null;
      password_audience: PasswordAudience;
    }
  | { status: 'expired' | 'consumed' | 'revoked' | 'unknown' };

/**
 * 12.2's `/activate?token=…` flow — verify → set password → auto sign in.
 * Sits in `account-access` rather than `auth` because it's built entirely
 * out of `AuthTokenService` (12.1) plus `AuthService.startSession` (the
 * session-issuance tail extracted for exactly this reuse).
 */
@Injectable()
export class ActivationService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly authTokens: AuthTokenService,
    @Inject(AuthService) private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly invitations: InvitationService,
    private readonly delivery: AccountAccessDeliveryService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly sessionCutoff: SessionCutoffService,
  ) {}

  /**
   * Read-only status check the client renders before showing the
   * set-password form. Never returns email/phone — only `full_name` and
   * `school_name` (the plan's own correction) — and never throws a 4xx: an
   * expired/consumed/revoked/unknown token is a valid *result*, not an
   * error, because the page has honest copy for every one of them.
   */
  async verify(raw: string): Promise<ActivateVerifyResult> {
    const result = await this.authTokens.verify(raw, AuthTokenPurpose.INVITE);
    if (result.status !== 'valid') {
      return { status: result.status };
    }

    const user = await this.userRepo.findOne({ where: { id: result.row.user_id } });
    if (!user) {
      return { status: 'unknown' };
    }
    // Same answer `activate()` gives: an INVITE never replaces a password, so don't offer the form.
    if (user.password_hash !== null) {
      return { status: 'consumed' };
    }

    const school = result.row.tenant_id
      ? await this.schoolRepo.findOne({ where: { id: result.row.tenant_id } })
      : null;

    const memberships = await this.userTenantRepo.find({ where: { user_id: user.id } });
    return {
      status: 'valid',
      full_name: user.full_name,
      school_name: school?.name ?? null,
      password_audience: audienceForRoles(memberships.map((m) => m.role)),
    };
  }

  /**
   * Consumes the token, sets the password, marks the account active, and
   * signs the caller in. Any non-`valid` verify status becomes a
   * `BadRequestException` whose `message` is that exact status string
   * (`expired` / `consumed` / `revoked` / `unknown`) so the client's error
   * mapping can render the matching state without parsing free text.
   */
  async activate(raw: string, password: string, context: RequestContext): Promise<AuthResult> {
    const verifyResult = await this.authTokens.verify(raw, AuthTokenPurpose.INVITE);
    if (verifyResult.status !== 'valid') {
      throw new BadRequestException(verifyResult.status);
    }
    const { row } = verifyResult;

    const user = await this.userRepo.findOne({ where: { id: row.user_id } });
    if (!user) {
      throw new BadRequestException('unknown');
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new BadRequestException('suspended');
    }
    // An INVITE only ever sets a first password; it can never replace one.
    if (user.password_hash !== null) {
      throw new BadRequestException('consumed');
    }

    await assertPasswordAllowedForUser(this.userTenantRepo, user.id, password);
    const password_hash = await hashPassword(password);

    // [12.7] Activating an invite proves the invitee controls whichever
    // contact the invite actually went out on (`InvitationService.issueAndSend`
    // records `metadata.channel`/`metadata.contact`) — an EMAIL invite
    // verifies the email, a PHONE (SMS) invite verifies the phone.
    //
    // Bound to the delivered VALUE, not just the medium: if an admin edited
    // the contact after the invite went out, the person holding that link
    // proved control of the OLD address, so activating it must not mark the
    // REPLACEMENT verified. A metadata fingerprint that no longer matches the
    // current value stamps nothing — as does a pre-12.7 invite row carrying
    // neither field, which is the same "don't guess" stance.
    const inviteMeta = row.metadata as { channel?: string; contact?: string } | null;
    const invitedField: 'email' | 'phone' | null =
      inviteMeta?.channel === 'EMAIL' ? 'email' : inviteMeta?.channel === 'SMS' ? 'phone' : null;
    const currentContact = invitedField === 'email' ? user.email : user.phone;
    const contactUnchanged =
      !!inviteMeta?.contact &&
      !!currentContact &&
      normalizeLoginIdentifier(currentContact) === inviteMeta.contact;
    const verifiedField: 'email' | 'phone' | null = contactUnchanged ? invitedField : null;

    await this.dataSource.transaction(async (manager) => {
      // An INACTIVE invitee becomes ACTIVE on activation; an already-ACTIVE
      // user (re-activating via a still-live invite link) stays ACTIVE.
      // Conditional write (same as `FirstPasswordService`): the check above ran outside this
      // transaction, so a password set since then (a racing activate, first-password or
      // recovery) makes this match nothing and the whole activation rolls back.
      const written = await manager.getRepository(User).update(
        { id: user.id, password_hash: IsNull() },
        {
          password_hash,
          status: UserStatus.ACTIVE,
          ...(verifiedField === 'email' ? { email_verified_at: new Date() } : {}),
          ...(verifiedField === 'phone' ? { phone_verified_at: new Date() } : {}),
        },
      );
      if (written.affected !== 1) {
        throw new BadRequestException('consumed');
      }
      await this.authTokens.consume(row.id, manager);
      await this.auditService.record(
        {
          action: AuditAction.ACCOUNT_ACTIVATED,
          entity_type: 'User',
          entity_id: user.id,
          tenant_id: row.tenant_id,
          performed_by_user_id: user.id,
          ip_address: context.ip,
          user_agent: context.userAgent,
        },
        manager,
      );
      if (verifiedField) {
        await this.auditService.record(
          {
            action: AuditAction.CONTACT_VERIFIED,
            entity_type: 'User',
            entity_id: user.id,
            tenant_id: row.tenant_id,
            performed_by_user_id: user.id,
            ip_address: context.ip,
            user_agent: context.userAgent,
            new_values: { field: verifiedField, via: 'activation' },
          },
          manager,
        );
      }
    });

    // After commit, like `RecoveryService.applyNewPassword`, and before `startSession` so the
    // new session survives. If this throws, the password is already set and old sessions live on.
    await this.refreshTokens.revokeAllForUser(user.id);
    await this.sessionCutoff.cutOff(user.id); // [75.2] access tokens too; before startSession
    await this.authService.resetLoginLockouts(user);

    return this.authService.startSession(user, context);
  }

  /**
   * Self-service resend, enumeration-safe: always resolves, never throws,
   * and never logs the identifier. Reissues only when the account is
   * genuinely passwordless (never activated) and holds a live-or-expired
   * invite — a used/revoked invite, an already-active account, or an
   * unknown identifier are all silent no-ops from the caller's point of
   * view.
   *
   * [75.17] The request path is the user lookup and nothing else: every
   * branch runs in the detached job, so known and unknown identifiers cost the
   * same one query. Best-effort, deliberately swallowed (detach logs, never
   * throws): surfacing *why* a resend didn't go out (delivery outage, a
   * ConflictException race with a concurrent activation) would leak the exact
   * "does this account exist" signal this endpoint exists to hide.
   */
  async resend(identifier: string): Promise<void> {
    const normalized = normalizeLoginIdentifier(identifier);
    const user = await this.userRepo.findOne({
      where: [
        { email: normalized, deleted_at: IsNull() },
        { phone: normalized, deleted_at: IsNull() },
      ],
    });
    await this.delivery.detach('activation-resend', () => this.resendJob(user));
  }

  private async resendJob(user: User | null): Promise<void> {
    if (!user || user.password_hash !== null) {
      return;
    }

    const latest = await this.authTokens.latest(user.id, AuthTokenPurpose.INVITE);
    if (!latest || !latest.tenant_id) {
      return;
    }
    // A revoked or already-consumed invite must not be reissued — only "no
    // invite yet" and "expired" are eligible for a fresh one.
    if (latest.revoked_at || latest.consumed_at) {
      return;
    }

    await this.invitations.issueAndSend({
      userId: user.id,
      tenantId: latest.tenant_id,
      actorUserId: null,
    });
  }
}
