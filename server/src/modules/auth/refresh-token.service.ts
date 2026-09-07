import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { randomBytes, randomUUID } from 'crypto';
import { RefreshToken } from './entities/refresh-token.entity';
import { hashSecret, safeEqualHex } from './token-hash.util';

export const REFRESH_TOKEN_TTL_MS = 'REFRESH_TOKEN_TTL_MS';

// Two concurrent refresh requests racing on the same token are the classic
// bug this exists to absorb: without it, the second request to land would
// see an already-rotated (revoked) token and treat a legitimate client as
// an attacker. Kept short and bounded (MAX_GRACE_HOPS) so it only covers a
// genuine race, not an ongoing pattern of reuse.
const GRACE_MS = 10_000;
const MAX_GRACE_HOPS = 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export interface IssuedRefreshToken {
  cookieValue: string;
  expiresAt: Date;
}

export interface RotateResult {
  userId: string;
  refreshToken: IssuedRefreshToken;
}

/** One row per live family — see `listActiveSessions`. */
export interface ActiveSession {
  familyId: string;
  startedAt: Date;
  lastUsedAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

/**
 * Thrown when a refresh token is presented after it was already rotated,
 * outside the concurrent-refresh grace window — the chain of custody for
 * this token family is broken, so every token in it must be treated as
 * potentially compromised. Carries family/user so the caller (AuthService)
 * can write the TOKEN_REUSE_DETECTED audit record with request context this
 * service doesn't have.
 */
export class RefreshTokenReuseDetectedException extends UnauthorizedException {
  constructor(
    public readonly userId: string,
    public readonly familyId: string,
  ) {
    super('Refresh token reuse detected');
  }
}

/**
 * Persists refresh tokens as a selector/validator pair: `id` (the row's
 * primary key) is the selector, looked up directly with no scan; the
 * random secret half (the validator) is never stored, only its SHA-256
 * hash. A fast hash is the right tool here — unlike password storage, this
 * is a 256-bit random secret with no brute-forceable structure, so there is
 * no CodeQL-flagged anti-pattern in hashing it directly (see docs-auth.ts's
 * safeCompare for the equivalent reasoning on the password-adjacent case).
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly repo: Repository<RefreshToken>,
    @Inject(REFRESH_TOKEN_TTL_MS) private readonly ttlMs: number,
  ) {}

  private buildCookieValue(id: string, secret: string): string {
    return `${id}.${secret}`;
  }

  private parseCookieValue(value: string): { id: string; secret: string } | null {
    const separatorIndex = value.indexOf('.');
    if (separatorIndex === -1) return null;
    const id = value.slice(0, separatorIndex);
    const secret = value.slice(separatorIndex + 1);
    // The id becomes a `WHERE id = :id` against a uuid column below — a
    // non-UUID value there is a Postgres type error (500), not a missing
    // row (401), if it reaches the query at all. Rejecting the shape here
    // keeps every malformed selector on the same "invalid token" path.
    if (!id || !secret || !UUID_PATTERN.test(id)) return null;
    return { id, secret };
  }

  async issueForUser(
    userId: string,
    familyId: string,
    context: RequestContext,
  ): Promise<IssuedRefreshToken> {
    return this.issueWithId(randomUUID(), userId, familyId, context);
  }

  // Split out so rotateRow can generate the successor's id itself, before
  // deciding whether it's actually allowed to issue it (see the conditional
  // update in rotateRow).
  private async issueWithId(
    id: string,
    userId: string,
    familyId: string,
    context: RequestContext,
  ): Promise<IssuedRefreshToken> {
    const secret = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.ttlMs);

    await this.repo.insert({
      id,
      user_id: userId,
      family_id: familyId,
      token_hash: hashSecret(secret),
      expires_at: expiresAt,
      revoked_at: null,
      replaced_by_id: null,
      ip_address: context.ip,
      user_agent: context.userAgent,
    });

    return { cookieValue: this.buildCookieValue(id, secret), expiresAt };
  }

  async rotate(cookieValue: string, context: RequestContext): Promise<RotateResult> {
    const parsed = this.parseCookieValue(cookieValue);
    if (!parsed) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.rotateById(parsed.id, parsed.secret, context, 0);
  }

  private async rotateById(
    id: string,
    secret: string,
    context: RequestContext,
    hops: number,
  ): Promise<RotateResult> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row || !safeEqualHex(row.token_hash, hashSecret(secret))) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.rotateRow(row, context, hops);
  }

  private async rotateRow(
    row: RefreshToken,
    context: RequestContext,
    hops: number,
  ): Promise<RotateResult> {
    if (row.expires_at.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (row.revoked_at) {
      const withinGrace = Date.now() - row.revoked_at.getTime() <= GRACE_MS;
      if (withinGrace && row.replaced_by_id && hops < MAX_GRACE_HOPS) {
        // We don't have the successor's raw secret — only its hash is
        // stored — so we can't hand back the exact pair the other request
        // received. Instead we rotate again starting from the successor,
        // which gives this caller an equally valid fresh pair without
        // flagging a race neither side caused.
        const successor = await this.repo.findOne({ where: { id: row.replaced_by_id } });
        if (!successor) {
          throw new UnauthorizedException('Invalid refresh token');
        }
        return this.rotateRow(successor, context, hops + 1);
      }

      await this.revokeFamily(row.family_id);
      throw new RefreshTokenReuseDetectedException(row.user_id, row.family_id);
    }

    // The read above and the write below aren't atomic — two concurrent
    // requests presenting the same live token would otherwise both observe
    // revoked_at === null and both issue a successor, leaving two live
    // tokens in one family with the second write silently clobbering the
    // first successor's replaced_by_id. Making the claim itself a
    // conditional UPDATE closes that: only the request whose UPDATE
    // actually matches a still-live row may issue the successor. A
    // concurrent loser matches zero rows and re-reads, falling through to
    // the grace/reuse logic above exactly as if it had arrived slightly
    // later.
    const successorId = randomUUID();
    const claim = await this.repo
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revoked_at: new Date(), replaced_by_id: successorId })
      .where('id = :id', { id: row.id })
      .andWhere('revoked_at IS NULL')
      .execute();

    if (!claim.affected) {
      const reread = await this.repo.findOne({ where: { id: row.id } });
      if (!reread) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      return this.rotateRow(reread, context, hops + 1);
    }

    const issued = await this.issueWithId(successorId, row.user_id, row.family_id, context);
    return { userId: row.user_id, refreshToken: issued };
  }

  /** Revokes the presented token and reports whose it was, or null if it wasn't a valid, live token. */
  async revokeByCookieValue(cookieValue: string): Promise<string | null> {
    const parsed = this.parseCookieValue(cookieValue);
    if (!parsed) return null;

    const row = await this.repo.findOne({ where: { id: parsed.id } });
    if (!row || !safeEqualHex(row.token_hash, hashSecret(parsed.secret))) return null;
    if (row.revoked_at) return null;

    await this.repo.update(row.id, { revoked_at: new Date() });
    return row.user_id;
  }

  /** How many rows (any revocation state) this family has for this user — used to tell "not this user's family" (0) from "already revoked" (>0) before revoking it. */
  async countForFamily(familyId: string, userId: string): Promise<number> {
    return this.repo.count({ where: { family_id: familyId, user_id: userId } });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revoked_at: new Date() })
      .where('family_id = :familyId', { familyId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  async revokeAllForUser(userId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(RefreshToken) : this.repo;
    await repo
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revoked_at: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  /**
   * One row per live family: rotation revokes the predecessor
   * (`rotateRow` above), so a family has at most one row with
   * `revoked_at IS NULL` at any time — the live-row filter alone is enough
   * to give one row per family, no `DISTINCT ON` / window function needed.
   * `started_at` (when the family was first created, i.e. when the device
   * logged in) is not on that live row — a rotated family's live row has a
   * later `created_at` — so it's fetched separately as the family's
   * earliest row and merged in TS.
   */
  async listActiveSessions(userId: string): Promise<ActiveSession[]> {
    const liveRows = await this.repo
      .createQueryBuilder('rt')
      .where('rt.user_id = :userId', { userId })
      .andWhere('rt.revoked_at IS NULL')
      .andWhere('rt.expires_at > :now', { now: new Date() })
      .orderBy('rt.created_at', 'DESC')
      .getMany();

    if (liveRows.length === 0) return [];

    const startedAtRows = await this.repo
      .createQueryBuilder('rt')
      .select('rt.family_id', 'family_id')
      .addSelect('MIN(rt.created_at)', 'started_at')
      .where('rt.user_id = :userId', { userId })
      .groupBy('rt.family_id')
      .getRawMany<{ family_id: string; started_at: Date }>();
    const startedAtByFamily = new Map(
      startedAtRows.map((row) => [row.family_id, new Date(row.started_at)]),
    );

    return liveRows.map((row) => ({
      familyId: row.family_id,
      startedAt: startedAtByFamily.get(row.family_id) ?? row.created_at,
      lastUsedAt: row.created_at,
      userAgent: row.user_agent,
      ipAddress: row.ip_address,
    }));
  }

  /**
   * The family the presented refresh cookie belongs to, or null. Read-only:
   * no rotation, no reuse detection, no revocation side effect — this backs
   * a listing endpoint, and firing family revocation from a read would be a
   * denial-of-service on the user's own account.
   */
  async familyIdForCookie(cookieValue: string | undefined): Promise<string | null> {
    if (!cookieValue) return null;
    const parsed = this.parseCookieValue(cookieValue);
    if (!parsed) return null;

    const row = await this.repo.findOne({ where: { id: parsed.id } });
    if (!row || !safeEqualHex(row.token_hash, hashSecret(parsed.secret))) return null;
    return row.family_id;
  }

  /** Deletes rows past their expiry — including long-revoked ones, since expiry is a hard upper bound regardless of revocation. Returns the number of rows removed. */
  async cleanupExpired(): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where('expires_at < :now', { now: new Date() })
      .execute();
    return result.affected ?? 0;
  }
}
