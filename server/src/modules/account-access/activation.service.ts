import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AuditAction, AuthTokenPurpose, UserStatus } from '@biddaloy/shared';
import { User } from '../users/entities/user.entity';
import { School } from '../schools/entities/school.entity';
import { AuditService } from '../audit/audit.service';
import { AuthService, AuthResult } from '../auth/auth.service';
import { RequestContext } from '../auth/refresh-token.service';
import { normalizeLoginIdentifier } from '../auth/normalize-identifier';
import { AuthTokenService } from './auth-token.service';
import { InvitationService } from './invitation.service';

const BCRYPT_COST = 10;

export type ActivateVerifyResult =
  | { status: 'valid'; full_name: string; school_name: string | null }
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
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly authTokens: AuthTokenService,
    @Inject(AuthService) private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly invitations: InvitationService,
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

    const school = result.row.tenant_id
      ? await this.schoolRepo.findOne({ where: { id: result.row.tenant_id } })
      : null;

    return { status: 'valid', full_name: user.full_name, school_name: school?.name ?? null };
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

    const password_hash = await bcrypt.hash(password, BCRYPT_COST);

    await this.dataSource.transaction(async (manager) => {
      // An INACTIVE invitee becomes ACTIVE on activation; an already-ACTIVE
      // user (re-activating via a still-live invite link) stays ACTIVE.
      await manager.getRepository(User).update(
        { id: user.id },
        {
          password_hash,
          status: UserStatus.ACTIVE,
          // TODO(12.7): stamp email_verified_at / phone_verified_at here
          // once those columns exist — activation implies whichever
          // channel the invite went out on is verified.
        },
      );
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
    });

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
   */
  async resend(identifier: string): Promise<void> {
    const normalized = normalizeLoginIdentifier(identifier);
    const user = await this.userRepo.findOne({
      where: [
        { email: normalized, deleted_at: IsNull() },
        { phone: normalized, deleted_at: IsNull() },
      ],
    });
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

    try {
      await this.invitations.issueAndSend({
        userId: user.id,
        tenantId: latest.tenant_id,
        actorUserId: null,
      });
    } catch {
      // Best-effort, deliberately swallowed: this endpoint always returns
      // 202 regardless of what happens underneath (delivery outage,
      // ConflictException races with a concurrent activation, etc) — an
      // enumeration-safe endpoint cannot surface *why* a resend didn't go
      // out without leaking exactly the "does this account exist" signal
      // it exists to hide.
    }
  }
}
