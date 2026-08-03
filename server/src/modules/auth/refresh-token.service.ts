import { Injectable, Inject, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomBytes, randomUUID, createHash, timingSafeEqual } from "crypto";
import { RefreshToken } from "./entities/refresh-token.entity";

export const REFRESH_TOKEN_TTL_MS = "REFRESH_TOKEN_TTL_MS";

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
    super("Refresh token reuse detected");
  }
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

// Both sides are always 64-char sha256 hex digests once decoded, so the
// length check never rejects a well-formed comparison before
// timingSafeEqual runs — it only guards the (attacker-controlled) input
// from ever reaching timingSafeEqual with a mismatched length, which would
// throw rather than leak timing.
function safeEqualHex(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
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
    const separatorIndex = value.indexOf(".");
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

  async issueForUser(userId: string, familyId: string, context: RequestContext): Promise<IssuedRefreshToken> {
    const id = randomUUID();
    const secret = randomBytes(32).toString("hex");
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
      throw new UnauthorizedException("Invalid refresh token");
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
      throw new UnauthorizedException("Invalid refresh token");
    }
    return this.rotateRow(row, context, hops);
  }

  private async rotateRow(row: RefreshToken, context: RequestContext, hops: number): Promise<RotateResult> {
    if (row.expires_at.getTime() < Date.now()) {
      throw new UnauthorizedException("Refresh token expired");
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
          throw new UnauthorizedException("Invalid refresh token");
        }
        return this.rotateRow(successor, context, hops + 1);
      }

      await this.revokeFamily(row.family_id);
      throw new RefreshTokenReuseDetectedException(row.user_id, row.family_id);
    }

    const issued = await this.issueForUser(row.user_id, row.family_id, context);
    const newId = this.parseCookieValue(issued.cookieValue)!.id;

    await this.repo.update(row.id, {
      revoked_at: new Date(),
      replaced_by_id: newId,
    });

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

  async revokeFamily(familyId: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revoked_at: new Date() })
      .where("family_id = :familyId", { familyId })
      .andWhere("revoked_at IS NULL")
      .execute();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revoked_at: new Date() })
      .where("user_id = :userId", { userId })
      .andWhere("revoked_at IS NULL")
      .execute();
  }

  /** Deletes rows past their expiry — including long-revoked ones, since expiry is a hard upper bound regardless of revocation. Returns the number of rows removed. */
  async cleanupExpired(): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where("expires_at < :now", { now: new Date() })
      .execute();
    return result.affected ?? 0;
  }
}
