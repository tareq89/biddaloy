import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuthTokenPurpose } from '@biddaloy/shared';
import { AuthToken } from './entities/auth-token.entity';
import { generateSecret, hashSecret } from '../auth/token-hash.util';

export const INVITE_TTL_MS = 7 * 24 * 3_600_000;
export const PASSWORD_RESET_TTL_MS = 3_600_000;
export const EMAIL_VERIFY_TTL_MS = 3_600_000;

export interface IssueTokenInput {
  userId: string;
  tenantId: string | null;
  purpose: AuthTokenPurpose;
  ttlMs: number;
  createdByUserId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface IssuedAuthToken {
  raw: string;
  row: AuthToken;
}

export type VerifyResult =
  { status: 'valid'; row: AuthToken } | { status: 'expired' | 'consumed' | 'revoked' | 'unknown' };

/**
 * Shared issue/verify/consume/revoke lifecycle for every `auth_tokens` row
 * (12.1, D2) — invitations (12.1), password resets (12.3), and email
 * verification (12.7) all go through this rather than re-implementing the
 * hash-and-compare dance `RefreshTokenService` already solved once.
 *
 * The raw token is only ever returned from `issue()` and never logged —
 * every other read (`verify`, `latest`) only ever sees the hash.
 */
@Injectable()
export class AuthTokenService {
  constructor(
    @InjectRepository(AuthToken)
    private readonly repo: Repository<AuthToken>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Revokes every still-live token of the same (user, purpose) first — a
   * resend/reissue must invalidate every prior link, not just leave a new
   * one alongside the old (the "resend invalidates prior links" AC).
   *
   * Two concurrent `issue()` calls for the same (user, purpose) could each
   * revoke-then-insert without ever seeing the other's row, leaving two
   * live tokens `verify()` would both accept. A Postgres advisory lock
   * scoped to `hashtext(userId || purpose)` serializes that pair of
   * statements across concurrent transactions without a schema change or a
   * unique-partial-index migration.
   */
  async issue(input: IssueTokenInput): Promise<IssuedAuthToken> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.userId}:${input.purpose}`,
      ]);

      const revokeQb = manager
        .createQueryBuilder()
        .update(AuthToken)
        .set({ revoked_at: new Date() })
        .where('user_id = :userId', { userId: input.userId })
        .andWhere('purpose = :purpose', { purpose: input.purpose })
        .andWhere('consumed_at IS NULL')
        .andWhere('revoked_at IS NULL');
      // A reissue must only ever invalidate this same tenant's prior link —
      // never silently revoke another tenant's live token for the same
      // user (a cross-tenant side effect, same class of bug as scoping
      // `latest`/`revokeLive` below by tenantId).
      if (input.tenantId) {
        revokeQb.andWhere('tenant_id = :tenantId', { tenantId: input.tenantId });
      }
      await revokeQb.execute();

      const raw = generateSecret();
      const row = manager.getRepository(AuthToken).create({
        user_id: input.userId,
        tenant_id: input.tenantId,
        purpose: input.purpose,
        token_hash: hashSecret(raw),
        expires_at: new Date(Date.now() + input.ttlMs),
        consumed_at: null,
        revoked_at: null,
        created_by_user_id: input.createdByUserId ?? null,
        metadata: input.metadata ?? null,
      });
      const saved = await manager.getRepository(AuthToken).save(row);
      return { raw, row: saved };
    });
  }

  async verify(raw: string, purpose: AuthTokenPurpose): Promise<VerifyResult> {
    const row = await this.repo.findOne({ where: { token_hash: hashSecret(raw), purpose } });
    if (!row) return { status: 'unknown' };
    if (row.revoked_at) return { status: 'revoked' };
    if (row.consumed_at) return { status: 'consumed' };
    if (row.expires_at.getTime() < Date.now()) return { status: 'expired' };
    return { status: 'valid', row };
  }

  /**
   * A single conditional `UPDATE ... WHERE consumed_at IS NULL AND
   * revoked_at IS NULL AND expires_at > now()`, not a read-then-write pair
   * — two concurrent requests racing a read/check/write would otherwise
   * both pass the check before either writes, consuming the same token
   * twice. `affected !== 1` covers "already consumed", "revoked since
   * `verify()` last looked", and "expired since `verify()` last looked" —
   * all a conflict, not a silent no-op.
   */
  async consume(rowId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuthToken) : this.repo;
    const result = await repo
      .createQueryBuilder()
      .update(AuthToken)
      .set({ consumed_at: new Date() })
      .where('id = :rowId', { rowId })
      .andWhere('consumed_at IS NULL')
      .andWhere('revoked_at IS NULL')
      .andWhere('expires_at > NOW()')
      .execute();
    if (result.affected !== 1) {
      throw new ConflictException('This link has already been used');
    }
  }

  /**
   * `tenantId` is optional only because `PASSWORD_RESET`/`EMAIL_VERIFY`
   * tokens aren't always issued against a single tenant. `INVITE` tokens
   * always are — callers scoping an invitation (`InvitationService`) must
   * pass it, or a same-user invitation in one tenant could revoke/read
   * another tenant's invitation for that user.
   */
  async revokeLive(userId: string, purpose: AuthTokenPurpose, tenantId?: string): Promise<void> {
    const qb = this.repo
      .createQueryBuilder()
      .update(AuthToken)
      .set({ revoked_at: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('purpose = :purpose', { purpose })
      .andWhere('consumed_at IS NULL')
      .andWhere('revoked_at IS NULL');
    if (tenantId) {
      qb.andWhere('tenant_id = :tenantId', { tenantId });
    }
    await qb.execute();
  }

  async latest(
    userId: string,
    purpose: AuthTokenPurpose,
    tenantId?: string,
  ): Promise<AuthToken | null> {
    return this.repo.findOne({
      where: { user_id: userId, purpose, ...(tenantId ? { tenant_id: tenantId } : {}) },
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Bulk form of `latest`, scoped to one tenant — used by list responses
   * (`UserResponseDto`'s `invitation_status`) so a page of N users costs one
   * query instead of N. Returns only the newest row per user id.
   */
  async latestMany(
    userIds: string[],
    purpose: AuthTokenPurpose,
    tenantId: string,
  ): Promise<Map<string, AuthToken>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.repo
      .createQueryBuilder('t')
      .distinctOn(['t.user_id'])
      .where('t.user_id IN (:...userIds)', { userIds })
      .andWhere('t.purpose = :purpose', { purpose })
      .andWhere('t.tenant_id = :tenantId', { tenantId })
      .orderBy('t.user_id')
      .addOrderBy('t.created_at', 'DESC')
      .getMany();

    return new Map(rows.map((row) => [row.user_id, row]));
  }
}
