import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Inject,
  Optional,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsOrder, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { User } from '../users/entities/user.entity';
import { UserTenant } from './entities/user-tenant.entity';
import { AuditService } from '../audit/audit.service';
import {
  JwtPayload,
  JwtMembership,
  LoginResponse,
  AuditAction,
  UserStatus,
  UserRole,
  PasswordChangeRequiredResponse,
} from '@biddaloy/shared';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LoginAttemptService } from './login-attempt.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { normalizeLoginIdentifier } from './normalize-identifier';
import {
  RefreshTokenService,
  RefreshTokenReuseDetectedException,
  IssuedRefreshToken,
  RequestContext,
} from './refresh-token.service';
import { AccessTokenDenylistService } from './access-token-denylist.service';
import { isUUID } from 'class-validator';
import { CompletePasswordResetDto } from './dto/complete-password-reset.dto';
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

// Matches the cost factor used at the only other place a password hash is
// created (UsersService.create) — a user's hash must not silently get
// weaker or slower depending on which endpoint last wrote it.
const BCRYPT_COST = 10;

// "Earliest membership wins" (#356). Both `getUserMemberships` (whose
// `memberships[0]` is the session's default tenant, preselected by
// SchoolPicker and queried by scripts/lighthouse-student-url.mjs) and
// `primaryTenantId` (which stamps the audit row) must resolve to the *same*
// membership, so they share one ordering rather than each spelling it out.
// `created_at` alone is not enough: a bulk import or a backfill migration
// can insert several memberships in one statement with identical
// timestamps, and the `id` tiebreak is what keeps the two call sites in
// agreement when that happens.
const EARLIEST_MEMBERSHIP_ORDER = {
  created_at: 'ASC',
  id: 'ASC',
} as const satisfies FindOptionsOrder<UserTenant>;

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepository: Repository<UserTenant>,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(LoginAttemptService) private readonly loginAttempts: LoginAttemptService,
    @Inject(RefreshTokenService) private readonly refreshTokens: RefreshTokenService,
    @Inject(AccessTokenDenylistService)
    private readonly accessTokenDenylist: AccessTokenDenylistService,
    @Inject(ACCESS_TOKEN_TTL_MS) private readonly accessTokenTtlMs: number,
    // Inject JwtStrategy to force eager creation — PassportModule needs it
    // to discover the strategy for AuthGuard('jwt').
    @Optional() @Inject(JwtStrategy) private readonly _jwtStrategy?: JwtStrategy,
  ) {}

  async validateUser(emailOrPhone: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: [{ email: emailOrPhone }, { phone: emailOrPhone }],
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
  ): Promise<AuthResult | PasswordChangeRequiredResponse> {
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

      await this.auditService.record({
        action: AuditAction.LOGIN_FAILED,
        entity_type: 'User',
        entity_id: user?.id ?? null,
        tenant_id: user ? await this.primaryTenantId(user.id) : null,
        performed_by_user_id: user?.id ?? null,
        ip_address: context.ip,
        user_agent: context.userAgent,
        new_values: { identifier },
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.password_change_required) {
      const memberships = await this.userTenantRepository.find({ where: { user_id: user.id } });
      const remaining = (user.temporary_password_expires_at?.getTime() ?? 0) - Date.now();
      const ttlSeconds = Math.min(300, Math.floor(remaining / 1000));
      if (!user.temporary_password_tenant_id || memberships.length === 0 ||
        memberships.some((membership) => membership.tenant_id !== user.temporary_password_tenant_id) || ttlSeconds < 1) {
        throw new UnauthorizedException('Invalid credentials');
      }
      const expiresAt = new Date((Math.floor(Date.now() / 1000) + ttlSeconds) * 1000);
      return {
        password_change_required: true,
        reset_token: this.jwtService.sign({
          purpose: 'complete_password_reset', sub: user.id,
          credential_version: user.credential_version,
          tenant_id: user.temporary_password_tenant_id, jti: randomUUID(),
        }, { expiresIn: ttlSeconds }),
        expires_at: expiresAt.toISOString(),
      };
    }

    await this.loginAttempts.reset(identifier);

    const membershipPayload = await this.fetchMembershipPayload(user.id);

    // Update last login timestamp
    await this.userRepository.update({ id: user.id }, { last_login_at: new Date() });

    await this.auditService.record({
      action: AuditAction.LOGIN,
      entity_type: 'User',
      entity_id: user.id,
      tenant_id: await this.primaryTenantId(user.id),
      performed_by_user_id: user.id,
      ip_address: context.ip,
      user_agent: context.userAgent,
    });

    // Every login starts a brand new rotation family — refresh tokens from
    // a previous login are never chained onto this one.
    const familyId = randomUUID();
    const refreshToken = await this.refreshTokens.issueForUser(user.id, familyId, context, user.credential_version);

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
        await this.auditService.record({
          action: AuditAction.TOKEN_REUSE_DETECTED,
          entity_type: 'User',
          entity_id: error.userId,
          tenant_id: await this.primaryTenantId(error.userId),
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
    if (!user || user.status !== UserStatus.ACTIVE || user.password_change_required ||
      user.credential_version !== rotated.credentialVersion) {
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

    await this.auditService.record({
      action: AuditAction.LOGOUT,
      entity_type: 'User',
      entity_id: userId,
      tenant_id: await this.primaryTenantId(userId),
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

    await this.auditService.record({
      action: AuditAction.LOGOUT,
      entity_type: 'User',
      entity_id: userId,
      tenant_id: await this.primaryTenantId(userId),
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { scope: 'all_sessions' },
    });
  }

  /**
   * Rotates the caller's own password hash after verifying the current one.
   *
   * Session semantics (deliberate — see issue #334):
   *   - Every refresh token for this user is revoked, so **all other
   *     sessions** die. Someone changing their password because they think
   *     it leaked wants the attacker signed out everywhere.
   *   - The caller's own access token is **not** denylisted, and a fresh
   *     rotation family is issued for them immediately (exactly as `login`
   *     does). The device that just performed the change stays signed in —
   *     being logged out of the tab you're looking at is a confusing way to
   *     be told the change worked.
   *   - This is why `logoutAll` is not reused here: it denylists the
   *     caller's jti and issues nothing back, which would end the current
   *     session too.
   *
   * `LoginAttemptService` lockout is deliberately not wired in either.
   * That counter is keyed to the login identifier, so feeding it from here
   * would let anyone holding a stolen access token lock the real owner out
   * of logging in at all. Wrong-current-password attempts are braked by the
   * route's `STRICT_RATE_LIMIT` (5/60s), the same tier `login` uses.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    context: RequestContext,
  ): Promise<AuthResult> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    // Same rule as `refresh`: a suspended user holding a still-valid access
    // token must not be able to act, and must not learn anything from the
    // difference between "no such user" and "not active".
    if (!user || user.status !== UserStatus.ACTIVE || user.password_change_required) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // A null hash (accounts created without a password — see
    // UsersService.create) can never match; comparing against the dummy
    // hash anyway keeps the bcrypt cost paid in every branch.
    const currentMatches = await bcrypt.compare(
      dto.current_password,
      user.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user.password_hash || !currentMatches) {
      // 403, deliberately NOT 401. The shared frontend axios client
      // (ui/src/api/client.ts) treats any 401 as an expired access token: it
      // silently refreshes and REPLAYS the request exactly once. A single
      // mistyped current password would therefore cost two of this route's
      // five-per-minute budget, and a refresh leg that failed for any reason
      // would clear auth state and sign the user out mid-form. 401 on this
      // endpoint must mean "your token is bad" and nothing else; a wrong
      // `current_password` is an authenticated caller being refused, which is
      // what 403 is for. The client does not replay 403.
      throw new ForbiddenException('Current password is incorrect');
    }

    // Write the new hash straight to the column rather than mutating the
    // loaded entity. `user` is reused below — to reset lockouts and to sign
    // the access token — and neither needs the password, so keeping the new
    // hash off that object means no password material is ever in scope on
    // the path that produces the token and the refresh cookie. A targeted
    // update also avoids `save()` writing back every column that was read at
    // the top of this method.
    const password_hash = await bcrypt.hash(dto.new_password, BCRYPT_COST);
    await this.userRepository.manager.transaction(async (manager) => {
      const current = await manager.getRepository(User).findOne({
        where: { id: user.id }, lock: { mode: 'pessimistic_write' },
      });
      if (!current || current.status !== UserStatus.ACTIVE || current.password_change_required ||
        current.password_hash !== user.password_hash || current.credential_version !== user.credential_version) {
        throw new ForbiddenException('Credentials changed; sign in again');
      }
      await manager.update(User, { id: user.id }, { password_hash });
      await this.refreshTokens.revokeAllForUser(userId, manager);
    });
    // Intentionally NO this.accessTokenDenylist.revoke(...) here — see the
    // session semantics in this method's doc comment.

    // Clear any login lockout the *old* password earned. Without this, a user
    // who forgot their password, failed login five times, and then changed it
    // from a still-live session in another tab would keep being rejected at
    // /auth/login with a generic "Invalid credentials" for the rest of the
    // lockout window — with the new, correct password. `login()` resets on
    // success for the same reason.
    //
    // The lockout is keyed by normalized identifier and a user may hold both
    // an email and a phone, either of which they could have been locked out
    // on, so every identifier this user actually has gets reset — not just one.
    await this.resetLoginLockouts(user);

    const membershipPayload = await this.fetchMembershipPayload(userId);

    // `PASSWORD_CHANGED` would need a Postgres enum migration (audit_logs.action
    // is an enum column), and this issue ships none — so the row reuses UPDATE
    // with a `{ scope: 'password' }` marker, mirroring logoutAll's
    // `{ scope: 'all_sessions' }`. No password material, old or new, hashed or
    // plain, ever goes into an audit row.
    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'User',
      entity_id: userId,
      tenant_id: await this.primaryTenantId(userId),
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: { scope: 'password' },
    });

    // A brand new rotation family, never chained onto the one just revoked.
    const familyId = randomUUID();
    const refreshToken = await this.refreshTokens.issueForUser(userId, familyId, context, user.credential_version);

    return {
      access_token: this.signAccessToken(user, membershipPayload),
      memberships: membershipPayload,
      refreshToken,
    };
  }

  async adminResetPassword(
    targetId: string, tenantId: string, actorId: string, context: RequestContext,
  ): Promise<{ temporary_password: string; expires_at: string }> {
    targetId = targetId.toLowerCase();
    actorId = actorId.toLowerCase();
    if (targetId === actorId) {
      throw new BadRequestException('Use change password to change your own password');
    }
    const result = await this.userRepository.manager.transaction('READ COMMITTED', async (manager) => {
      // Stable user ordering avoids reciprocal administrator-reset deadlocks.
      const users = new Map<string, User>();
      for (const id of [actorId, targetId].sort()) {
        const user = await manager.getRepository(User).findOne({
          where: { id }, lock: { mode: 'pessimistic_write' },
        });
        if (user) users.set(id, user);
      }
      const actor = users.get(actorId);
      const actorMembership = await manager.getRepository(UserTenant).findOne({
        where: { user_id: actorId, tenant_id: tenantId, role: UserRole.ADMIN },
        lock: { mode: 'pessimistic_read' },
      });
      if (!actor || actor.status !== UserStatus.ACTIVE || actor.password_change_required || !actorMembership) {
        throw new ForbiddenException('Administrator access required');
      }
      const memberships = await this.lockMemberships(manager, targetId);
      const target = users.get(targetId);
      if (!target || !memberships.some((membership) => membership.tenant_id === tenantId)) {
        throw new NotFoundException('User not found');
      }
      if (memberships.some((membership) => membership.tenant_id !== tenantId)) {
        throw new ConflictException('This account is not eligible for a school password reset');
      }
      if (target.status !== UserStatus.ACTIVE || !(target.email?.trim() || target.phone?.trim())) {
        throw new ConflictException('The account must be active and have a login identifier');
      }
      const temporaryPassword = randomBytes(24).toString('base64url');
      const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_COST);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
      await manager.update(User, { id: targetId }, {
        password_hash: passwordHash, password_change_required: true,
        temporary_password_expires_at: expiresAt, temporary_password_tenant_id: tenantId,
        credential_version: target.credential_version + 1,
      });
      await this.refreshTokens.revokeAllForUser(targetId, manager);
      await this.auditService.record({
        action: AuditAction.UPDATE, entity_type: 'User', entity_id: targetId,
        tenant_id: tenantId, performed_by_user_id: actorId,
        ip_address: context.ip, user_agent: context.userAgent,
        new_values: { scope: 'admin_password_reset' },
      }, manager);
      return { user: target, temporary_password: temporaryPassword, expires_at: expiresAt.toISOString() };
    });
    await this.resetLoginLockouts(result.user).catch(() => undefined);
    return { temporary_password: result.temporary_password, expires_at: result.expires_at };
  }

  async completePasswordReset(dto: CompletePasswordResetDto, context: RequestContext): Promise<void> {
    const invalid = () => new BadRequestException('Password reset is invalid or expired');
    let token: { purpose?: unknown; sub?: unknown; tenant_id?: unknown; credential_version?: unknown; exp?: unknown };
    try {
      token = this.jwtService.verify(dto.reset_token);
    } catch {
      throw invalid();
    }
    if (!token || token.purpose !== 'complete_password_reset' ||
      typeof token.sub !== 'string' || !isUUID(token.sub) ||
      typeof token.tenant_id !== 'string' || !isUUID(token.tenant_id) ||
      typeof token.credential_version !== 'number' || !Number.isInteger(token.credential_version) ||
      token.credential_version < 0 || typeof token.exp !== 'number' || token.exp * 1000 <= Date.now()) {
      throw invalid();
    }
    const userId = token.sub.toLowerCase();
    const tenantId = token.tenant_id.toLowerCase();
    const version = token.credential_version;
    const challengeExpiresAt = token.exp * 1000;
    const user = await this.userRepository.manager.transaction('READ COMMITTED', async (manager) => {
      const current = await manager.getRepository(User).findOne({
        where: { id: userId }, lock: { mode: 'pessimistic_write' },
      });
      const memberships = await this.lockMemberships(manager, userId);
      if (!current || current.status !== UserStatus.ACTIVE || !current.password_change_required ||
        !current.password_hash || current.credential_version !== version ||
        current.temporary_password_tenant_id !== tenantId || challengeExpiresAt <= Date.now() ||
        !current.temporary_password_expires_at || current.temporary_password_expires_at.getTime() <= Date.now() ||
        memberships.length === 0 || memberships.some((membership) => membership.tenant_id !== tenantId)) {
        throw invalid();
      }
      if (await bcrypt.compare(dto.new_password, current.password_hash)) {
        throw new BadRequestException('Choose a password different from the temporary password');
      }
      const passwordHash = await bcrypt.hash(dto.new_password, BCRYPT_COST);
      await manager.update(User, { id: userId }, {
        password_hash: passwordHash, password_change_required: false,
        temporary_password_expires_at: null, temporary_password_tenant_id: null,
        credential_version: version + 1,
      });
      await this.refreshTokens.revokeAllForUser(userId, manager);
      await this.auditService.record({
        action: AuditAction.UPDATE, entity_type: 'User', entity_id: userId,
        tenant_id: tenantId, performed_by_user_id: userId,
        ip_address: context.ip, user_agent: context.userAgent,
        new_values: { scope: 'admin_password_reset_completed' },
      }, manager);
      return current;
    });
    await this.resetLoginLockouts(user).catch(() => undefined);
  }

  private lockMemberships(manager: EntityManager, userId: string): Promise<UserTenant[]> {
    // User FOR UPDATE excludes FK inserts; FOR SHARE excludes membership edits/removal.
    // All memberships are intentionally inspected: credentials belong to the global identity.
    return manager.getRepository(UserTenant).find({
      where: { user_id: userId }, order: { id: 'ASC' }, lock: { mode: 'pessimistic_read' },
    });
  }

  private async resetLoginLockouts(user: User): Promise<void> {
    const identifiers = [user.email, user.phone]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(normalizeLoginIdentifier);
    await Promise.all(identifiers.map((identifier) => this.loginAttempts.reset(identifier)));
  }

  private async fetchMembershipPayload(userId: string): Promise<JwtMembership[]> {
    // `relations: ['tenant']` — [8.9.5]'s picker/top-bar need the school's
    // display name, not just its id; this join gets it in the same query
    // rather than a second round trip per membership.
    // Ordered oldest-first, not left to Postgres' arbitrary row order
    // (#356). Callers treat `memberships[0]` as "the default tenant" —
    // `SchoolPicker` preselects it and `scripts/lighthouse-student-url.mjs`
    // queries it — so an unordered result meant those two could disagree
    // about which school the session is in.
    const memberships = await this.userTenantRepository.find({
      where: { user_id: userId },
      relations: ['tenant'],
      order: EARLIEST_MEMBERSHIP_ORDER,
    });
    return memberships.map((m) => ({ tenantId: m.tenant_id, role: m.role, name: m.tenant.name }));
  }

  // A user can belong to several tenants, but an audit row needs exactly
  // one — this picks the earliest membership as a stable, deterministic
  // choice, the same rule the tenant-id backfill migrations use. It must
  // stay byte-for-byte the same ordering `getUserMemberships` uses, hence
  // the shared `EARLIEST_MEMBERSHIP_ORDER`: if the two diverged, the audit
  // tenant and `memberships[0]` could name different schools.
  private async primaryTenantId(userId: string): Promise<string | null> {
    // This lookup only feeds an audit record, but it runs before
    // AuditService.record() ever gets a chance to fail open — left
    // unguarded, a transient DB error here would reject login after
    // last_login_at is already saved, replace logout's response with a 500,
    // or turn TOKEN_REUSE_DETECTED's rethrow into an unrelated error.
    try {
      const membership = await this.userTenantRepository.findOne({
        where: { user_id: userId },
        order: EARLIEST_MEMBERSHIP_ORDER,
      });
      return membership?.tenant_id ?? null;
    } catch {
      return null;
    }
  }

  private signAccessToken(user: User, memberships: JwtMembership[]): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      phone: user.phone,
      memberships,
      jti: randomUUID(),
      credential_version: user.credential_version,
    };
    return this.jwtService.sign(payload);
  }
}
