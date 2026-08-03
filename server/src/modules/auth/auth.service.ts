import { Injectable, Logger, UnauthorizedException, Inject, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { User } from '../users/entities/user.entity';
import { UserTenant } from './entities/user-tenant.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { JwtPayload, JwtMembership, LoginResponse, AuditAction, UserStatus } from '@beton-boi/shared';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LoginAttemptService } from './login-attempt.service';
import { normalizeLoginIdentifier } from './normalize-identifier';
import {
  RefreshTokenService,
  RefreshTokenReuseDetectedException,
  IssuedRefreshToken,
  RequestContext,
} from './refresh-token.service';
import { AccessTokenDenylistService } from './access-token-denylist.service';
import { ACCESS_TOKEN_TTL_MS } from './auth-tokens';

export interface AuthResult extends LoginResponse {
  refreshToken: IssuedRefreshToken;
}

// Precomputed bcrypt hash of an arbitrary, non-secret string — never the
// hash of a real password. Used as the compare target when no user is
// found, so validateUser always pays bcrypt's cost. Without this, "no such
// user" returns near-instantly while "wrong password" takes ~bcrypt-cost
// time — a timing oracle that lets an attacker enumerate valid identifiers
// without ever seeing a different response body.
const DUMMY_PASSWORD_HASH = '$2b$10$rGV9zEDpgnc/spXBlHqA9O5IjpBvndIyZE78fIhV8ZV4.5GAUfPJ.';

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepository: Repository<UserTenant>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(LoginAttemptService) private readonly loginAttempts: LoginAttemptService,
    @Inject(RefreshTokenService) private readonly refreshTokens: RefreshTokenService,
    @Inject(AccessTokenDenylistService) private readonly accessTokenDenylist: AccessTokenDenylistService,
    @Inject(ACCESS_TOKEN_TTL_MS) private readonly accessTokenTtlMs: number,
    // Inject JwtStrategy to force eager creation — PassportModule needs it
    // to discover the strategy for AuthGuard('jwt').
    @Optional() @Inject(JwtStrategy) private readonly _jwtStrategy?: JwtStrategy,
  ) {}

  async validateUser(emailOrPhone: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: [
        { email: emailOrPhone },
        { phone: emailOrPhone },
      ],
    });

    const hashToCompare = user?.password_hash ?? DUMMY_PASSWORD_HASH;
    const isPasswordValid = await bcrypt.compare(password, hashToCompare);

    if (!user || !user.password_hash || !isPasswordValid) {
      return null;
    }

    return user;
  }

  async login(
    emailOrPhone: string,
    password: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<AuthResult> {
    const identifier = normalizeLoginIdentifier(emailOrPhone);
    const alreadyLocked = await this.loginAttempts.isLocked(identifier);

    // Always run the same validateUser path regardless of lock state, so
    // total request timing doesn't itself reveal whether this identifier is
    // currently locked out.
    const user = await this.validateUser(emailOrPhone, password);
    // A suspended/inactive user fails exactly like a wrong password — same
    // response, same audit action — so account status is never observable
    // from the outside, and a deactivated account can't just log back in
    // to route around logoutAll/refresh rejecting it (see refresh() below).
    const success = !!user && !alreadyLocked && user.status === UserStatus.ACTIVE;

    if (!success) {
      if (!alreadyLocked) {
        const { delayMs } = await this.loginAttempts.recordFailure(identifier);
        await sleep(delayMs);
      }

      await this.writeAuditLog({
        action: AuditAction.LOGIN_FAILED,
        entity_type: 'User',
        entity_id: user?.id ?? null,
        performed_by_user_id: user?.id ?? null,
        ip_address: context.ip,
        user_agent: context.userAgent,
        new_values: { identifier },
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    await this.loginAttempts.reset(identifier);

    const membershipPayload = await this.fetchMembershipPayload(user.id);

    // Update last login timestamp
    user.last_login_at = new Date();
    await this.userRepository.save(user);

    await this.writeAuditLog({
      action: AuditAction.LOGIN,
      entity_type: 'User',
      entity_id: user.id,
      performed_by_user_id: user.id,
      ip_address: context.ip,
      user_agent: context.userAgent,
    });

    // Every login starts a brand new rotation family — refresh tokens from
    // a previous login are never chained onto this one.
    const familyId = randomUUID();
    const refreshToken = await this.refreshTokens.issueForUser(user.id, familyId, context);

    return {
      access_token: this.signAccessToken(user, membershipPayload),
      memberships: membershipPayload,
      refreshToken,
    };
  }

  /**
   * Validates and rotates the presented refresh token, then issues a fresh
   * access token built from the user's *current* memberships — not the
   * ones baked into whatever access token was live when the client last
   * refreshed. This is what actually closes the "stale authorization"
   * edge #42 called out: a role/tenant revocation now takes effect within
   * one refresh cycle rather than waiting out the old 7-day token.
   */
  async refresh(cookieValue: string | undefined, context: RequestContext): Promise<AuthResult> {
    if (!cookieValue) {
      throw new UnauthorizedException('Missing refresh token');
    }

    let rotated;
    try {
      rotated = await this.refreshTokens.rotate(cookieValue, context);
    } catch (error) {
      if (error instanceof RefreshTokenReuseDetectedException) {
        await this.writeAuditLog({
          action: AuditAction.TOKEN_REUSE_DETECTED,
          entity_type: 'User',
          entity_id: error.userId,
          performed_by_user_id: error.userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          new_values: { family_id: error.familyId },
        });
      }
      throw error;
    }

    const user = await this.userRepository.findOne({ where: { id: rotated.userId } });
    // Rejects a deactivated/suspended user exactly like a missing one —
    // otherwise status changes would only ever take effect on access-token
    // expiry (~15 min), not immediately, defeating the point of checking
    // current state on every refresh (see this method's own doc comment).
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('User no longer exists');
    }

    const membershipPayload = await this.fetchMembershipPayload(user.id);

    return {
      access_token: this.signAccessToken(user, membershipPayload),
      memberships: membershipPayload,
      refreshToken: rotated.refreshToken,
    };
  }

  /**
   * Revokes the presented refresh token, if any, and audits the logout.
   * Deliberately does not require a valid access token: the access token
   * may well have already expired (that's the normal case, given its
   * ~15-minute lifetime) by the time a user gets around to logging out,
   * and that must not block revoking the much longer-lived refresh token.
   * A missing or already-invalid cookie is a no-op success — the client
   * has nothing left to revoke either way.
   */
  async logout(cookieValue: string | undefined, context: RequestContext): Promise<void> {
    if (!cookieValue) return;

    const userId = await this.refreshTokens.revokeByCookieValue(cookieValue);
    if (!userId) return;

    await this.writeAuditLog({
      action: AuditAction.LOGOUT,
      entity_type: 'User',
      entity_id: userId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
    });
  }

  /**
   * Revokes every refresh token for the calling user and denylists the
   * access token used to call this endpoint, so this specific session ends
   * immediately rather than riding out its remaining lifetime. Unlike
   * `logout`, this requires an authenticated caller (AuthGuard('jwt') on
   * the controller route) — "log out everywhere" needs a verified
   * identity, not just whatever cookie happens to be presented.
   */
  async logoutAll(userId: string, jti: string, context: RequestContext): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);
    // AccessTokenDenylistService.revoke() already fails open internally
    // (catches and logs, never rejects — see that file), so a Redis outage
    // here can't prevent the audit write below from running.
    await this.accessTokenDenylist.revoke(jti, this.accessTokenTtlMs);

    await this.writeAuditLog({
      action: AuditAction.LOGOUT,
      entity_type: 'User',
      entity_id: userId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { scope: 'all_sessions' },
    });
  }

  private async fetchMembershipPayload(userId: string): Promise<JwtMembership[]> {
    const memberships = await this.userTenantRepository.find({ where: { user_id: userId } });
    return memberships.map((m) => ({ tenantId: m.tenant_id, role: m.role }));
  }

  private signAccessToken(user: User, memberships: JwtMembership[]): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      phone: user.phone,
      memberships,
      jti: randomUUID(),
    };
    return this.jwtService.sign(payload);
  }

  // Audit logging is ancillary to authentication itself — a write failure
  // here must never break login. Left unguarded, a failure on the success
  // path would be worse than just a 500: last_login_at is already
  // persisted by the time this runs, so login would be "half-completed"
  // (timestamp updated) while the caller never receives a token.
  private async writeAuditLog(entry: {
    action: AuditAction;
    entity_type: string;
    entity_id: string | null;
    performed_by_user_id: string | null;
    ip_address: string | null;
    user_agent: string | null;
    new_values?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.auditLogRepository.save(this.auditLogRepository.create(entry));
    } catch (error) {
      this.logger.error(
        `Failed to write ${entry.action} audit record: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
