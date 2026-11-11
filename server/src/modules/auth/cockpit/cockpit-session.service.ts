import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { Repository } from 'typeorm';
import { UserStatus } from '@biddaloy/shared';
import { User } from '../../users/entities/user.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { COCKPIT_ACCESS_TOKEN_AUDIENCE } from '../jwt-secrets';
import {
  ActiveSession,
  RefreshTokenReuseDetectedException,
  RefreshTokenService,
  RequestContext,
} from '../refresh-token.service';
import { SessionCutoffService } from '../session-cutoff.service';
import { COCKPIT_IDLE_MAX_MS, COCKPIT_SESSION_MAX_MS } from './cockpit-token-cookie';

export const COCKPIT_REDIS = 'COCKPIT_REDIS';
/** Test seam: short lifetimes for the expiry specs. Defaults are 30 min idle / 8 h absolute. */
export const COCKPIT_SESSION_LIMITS = 'COCKPIT_SESSION_LIMITS';
export interface CockpitSessionLimits {
  idleMs: number;
  absoluteMs: number;
}

/** One sentence for every refusal here (Rule 23). */
export const COCKPIT_SESSION_ENDED = 'Your session has ended. Please sign in again.';

const ACCESS_TTL_SECONDS = 15 * 60;

export interface CockpitStarted {
  accessToken: string;
  refreshCookieValue: string;
  familyId: string;
  /** What is left of the 8 h absolute limit; the refresh cookie must not outlive it. */
  absoluteLeftMs: number;
}

@Injectable()
export class CockpitSessionService {
  private readonly limits: CockpitSessionLimits;

  constructor(
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly cutoff: SessionCutoffService,
    @Inject(COCKPIT_REDIS) private readonly redis: Redis,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(PlatformAdmin) private readonly admins: Repository<PlatformAdmin>,
    @Optional() @Inject(COCKPIT_SESSION_LIMITS) limits?: CockpitSessionLimits,
  ) {
    this.limits = limits ?? { idleMs: COCKPIT_IDLE_MAX_MS, absoluteMs: COCKPIT_SESSION_MAX_MS };
  }

  private absKey = (fam: string) => `cockpit:abs:${fam}`;
  private idleKey = (fam: string) => `cockpit:idle:${fam}`;

  /** Rule 15: a Redis failure refuses; it never lets a session through. */
  private async redisCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      throw new ServiceUnavailableException('Service temporarily unavailable');
    }
  }

  /** `issuedAt` defaults to now; a refresh passes the time it started (see refresh()). */
  private signAccess(userId: string, fam: string, issuedAt = Date.now()): string {
    return this.jwt.sign(
      { sub: userId, jti: randomUUID(), fam, typ: 'cockpit', iat_ms: issuedAt },
      { audience: COCKPIT_ACCESS_TOKEN_AUDIENCE, expiresIn: ACCESS_TTL_SECONDS },
    );
  }

  async start(userId: string, ctx: RequestContext): Promise<CockpitStarted> {
    const fam = randomUUID();
    await this.redisCall(async () => {
      await this.redis.set(this.absKey(fam), '1', 'PX', this.limits.absoluteMs);
      await this.redis.set(this.idleKey(fam), '1', 'PX', this.limits.idleMs);
    });
    const issued = await this.refreshTokens.issueForUser(userId, fam, ctx, this.limits.absoluteMs);
    return {
      accessToken: this.signAccess(userId, fam),
      refreshCookieValue: issued.cookieValue,
      familyId: fam,
      absoluteLeftMs: this.limits.absoluteMs,
    };
  }

  async refresh(cookie: string | undefined, ctx: RequestContext): Promise<CockpitStarted> {
    // Stamped before any check: a reset (cut-off) that lands while this refresh is in flight
    // is newer than the token, so the strategy refuses it instead of letting it live 15 min.
    const issuedAt = Date.now();
    const fam = cookie ? await this.refreshTokens.familyIdForCookie(cookie) : null;
    if (!fam) throw new UnauthorizedException(COCKPIT_SESSION_ENDED);

    const absLeft = await this.redisCall(async () => {
      const [abs, idle] = await Promise.all([
        this.redis.pttl(this.absKey(fam)),
        this.redis.exists(this.idleKey(fam)),
      ]);
      return abs > 0 && idle === 1 ? abs : 0;
    });
    if (!absLeft) throw new UnauthorizedException(COCKPIT_SESSION_ENDED);

    // A dead owner keeps no live row: check before rotating, and revoke the family if they fail.
    const owner = await this.refreshTokens.userIdForCookie(cookie as string);
    if (!owner || !(await this.isLiveOwner(owner))) {
      await this.refreshTokens.revokeFamily(fam);
      throw new UnauthorizedException(COCKPIT_SESSION_ENDED);
    }
    // The successor may not outlive the absolute limit: ttl is what is left of it.
    let rotated: Awaited<ReturnType<RefreshTokenService['rotate']>>;
    try {
      rotated = await this.refreshTokens.rotate(cookie as string, ctx, absLeft);
    } catch (error) {
      if (!(error instanceof RefreshTokenReuseDetectedException)) throw error;
      // rotate() already revoked the family; its access tokens live on the Redis keys, so drop
      // them too (strict: a Redis failure is a 503, never a token that stays alive).
      await this.dropKeys(fam, true);
      throw new UnauthorizedException(COCKPIT_SESSION_ENDED);
    }
    await this.touch(fam);
    return {
      accessToken: this.signAccess(rotated.userId, fam, issuedAt),
      refreshCookieValue: rotated.refreshToken.cookieValue,
      familyId: fam,
      absoluteLeftMs: absLeft,
    };
  }

  private async isLiveOwner(userId: string): Promise<boolean> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) return false;
    return (await this.admins.count({ where: { user_id: userId } })) > 0;
  }

  /** Renews the idle key only; a missing key (idle or absolute passed) is a refusal. */
  async touch(fam: string): Promise<void> {
    const ok = await this.redisCall(async () => {
      const abs = await this.redis.exists(this.absKey(fam));
      if (abs !== 1) return false;
      // XX: never resurrect an idle key that already expired.
      return (
        (await this.redis.set(this.idleKey(fam), '1', 'PX', this.limits.idleMs, 'XX')) === 'OK'
      );
    });
    if (!ok) throw new UnauthorizedException(COCKPIT_SESSION_ENDED);
  }

  async end(cookie: string | undefined): Promise<void> {
    if (!cookie) return;
    const fam = await this.refreshTokens.familyIdForCookie(cookie);
    await this.refreshTokens.revokeByCookieValue(cookie);
    if (fam) await this.dropKeys(fam, true);
  }

  /** Ends one family the user owns; false when it is not theirs (the controller answers 404). */
  async endFamily(userId: string, fam: string): Promise<boolean> {
    if ((await this.refreshTokens.countForFamily(fam, userId)) === 0) return false;
    await this.refreshTokens.revokeFamily(fam);
    await this.dropKeys(fam, true);
    return true;
  }

  async endAll(userId: string): Promise<void> {
    const families = await this.refreshTokens.listActiveSessions(userId);
    await this.refreshTokens.revokeAllForUser(userId);
    await this.cutoff.cutOff(userId); // Rule 8
    await Promise.all(families.map((s) => this.dropKeys(s.familyId)));
  }

  async list(userId: string): Promise<ActiveSession[]> {
    return this.refreshTokens.listActiveSessions(userId);
  }

  /**
   * The refresh rows are already revoked, so a stale key grants nothing to refresh, but the idle
   * and absolute keys would keep the access token alive. A single-session end therefore surfaces
   * a Redis failure as a 503 (`strict`); endAll is covered by tokens_valid_after and stays quiet.
   */
  private async dropKeys(fam: string, strict = false): Promise<void> {
    const del = () => this.redis.del(this.absKey(fam), this.idleKey(fam));
    if (strict) await this.redisCall(del);
    else await del().catch(() => undefined);
  }
}
