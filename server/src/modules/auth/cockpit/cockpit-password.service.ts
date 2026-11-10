import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AuditAction, AuthTokenPurpose, CommunicationMedium, UserStatus } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';
import { AuthTokenService, PASSWORD_RESET_TTL_MS } from '../../account-access/auth-token.service';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { User } from '../../users/entities/user.entity';
import { LoginAttemptService } from '../login-attempt.service';
import { normalizeLoginIdentifier } from '../normalize-identifier';
import { hashPassword } from '../password-hash';
import { assertPasswordAllowed } from '../password-policy';
import { RefreshTokenService, RequestContext } from '../refresh-token.service';
import { SessionCutoffService } from '../session-cutoff.service';
import { cockpitIdentifierLockKey, cockpitUserLockKey } from './cockpit-auth.service';
import { CockpitResetPasswordDto } from './dto/cockpit-password.dto';

/** One sentence for every refusal of a reset link (Rule 23). */
export const COCKPIT_RESET_REFUSED = 'This link is invalid or has expired.';

/**
 * [Epic 98] Owner password recovery on the cockpit host. The link carries a `PASSWORD_RESET`
 * token like the app does, but only an owner's token is honoured here and an owner's token is
 * refused by the app host (recovery.service.ts). Resetting never starts a session.
 */
@Injectable()
export class CockpitPasswordService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(PlatformAdmin) private readonly admins: Repository<PlatformAdmin>,
    private readonly authTokens: AuthTokenService,
    private readonly delivery: AccountAccessDeliveryService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly sessionCutoff: SessionCutoffService,
    private readonly loginAttempts: LoginAttemptService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Always resolves. The request path is one user lookup and nothing else: every other branch
   * (unknown, not an owner, locked, no email, send) runs detached, so all answers cost the same (Rule 18).
   */
  async forgot(identifier: string): Promise<void> {
    const normalized = normalizeLoginIdentifier(identifier);
    const user = await this.users.findOne({
      where: [
        { email: normalized, deleted_at: IsNull() },
        { phone: normalized, deleted_at: IsNull() },
      ],
    });
    void this.delivery.detach('cockpit-forgot-password', () => this.forgotJob(user));
  }

  private async forgotJob(user: User | null): Promise<void> {
    if (!user || user.status !== UserStatus.ACTIVE || !user.email) return;
    if (!(await this.admins.exists({ where: { user_id: user.id } }))) return;
    const { raw } = await this.authTokens.issue({
      userId: user.id,
      tenantId: null,
      purpose: AuthTokenPurpose.PASSWORD_RESET,
      ttlMs: PASSWORD_RESET_TTL_MS,
      // Binds the link to the address it was sent to, like the app flow.
      metadata: { email: normalizeLoginIdentifier(user.email) },
    });
    await this.delivery.deliver({
      tenantId: null,
      medium: CommunicationMedium.EMAIL,
      to: user.email,
      recipientName: user.full_name,
      kind: 'PASSWORD_RESET_LINK',
      vars: { link: this.buildLink(raw) },
    });
  }

  private buildLink(rawToken: string): string {
    const domain = this.config.get<string>('COCKPIT_DOMAIN');
    if (!domain) throw new Error('COCKPIT_DOMAIN is not configured');
    return `https://${domain}/sign-in/reset?token=${encodeURIComponent(rawToken)}`;
  }

  async reset(dto: CockpitResetPasswordDto, ctx: RequestContext): Promise<void> {
    const refused = () => new UnauthorizedException(COCKPIT_RESET_REFUSED);
    const result = await this.authTokens.verify(dto.token, AuthTokenPurpose.PASSWORD_RESET);
    if (result.status !== 'valid') throw refused();
    const user = await this.users.findOne({ where: { id: result.row.user_id } });
    // A school user's token (any tenant) is refused: only an owner's account resets here.
    if (!user || user.deleted_at || user.status !== UserStatus.ACTIVE || result.row.tenant_id) {
      throw refused();
    }
    if (!(await this.admins.exists({ where: { user_id: user.id } }))) throw refused();
    const sentTo = (result.row.metadata as { email?: string } | null)?.email;
    if (!sentTo || !user.email || normalizeLoginIdentifier(user.email) !== sentTo) throw refused();

    // Rules last, so a weak password does not burn the link. No roles: strictest staff rules.
    assertPasswordAllowed(dto.newPassword, []);
    await this.authTokens.consume(result.row.id);

    await this.users.update(user.id, { password_hash: await hashPassword(dto.newPassword) });
    await this.refreshTokens.revokeAllForUser(user.id);
    await this.sessionCutoff.cutOff(user.id); // Rule 8: access tokens too
    const keys = [user.email, user.phone]
      .filter((v): v is string => !!v?.trim())
      .map((v) => cockpitIdentifierLockKey(normalizeLoginIdentifier(v)));
    await Promise.all(
      [...keys, cockpitUserLockKey(user.id)].map((k) => this.loginAttempts.reset(k)),
    );
    await this.audit.record({
      action: AuditAction.PLATFORM_PASSWORD_RESET,
      entity_type: 'PlatformAdmin',
      entity_id: user.id,
      tenant_id: null,
      performed_by_user_id: user.id,
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
    });
  }
}
