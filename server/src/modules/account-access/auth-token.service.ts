import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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
  ) {}

  /**
   * Revokes every still-live token of the same (user, purpose) first — a
   * resend/reissue must invalidate every prior link, not just leave a new
   * one alongside the old (the "resend invalidates prior links" AC).
   */
  async issue(input: IssueTokenInput): Promise<IssuedAuthToken> {
    await this.revokeLive(input.userId, input.purpose);

    const raw = generateSecret();
    const row = this.repo.create({
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
    const saved = await this.repo.save(row);
    return { raw, row: saved };
  }

  async verify(raw: string, purpose: AuthTokenPurpose): Promise<VerifyResult> {
    const row = await this.repo.findOne({ where: { token_hash: hashSecret(raw), purpose } });
    if (!row) return { status: 'unknown' };
    if (row.revoked_at) return { status: 'revoked' };
    if (row.consumed_at) return { status: 'consumed' };
    if (row.expires_at.getTime() < Date.now()) return { status: 'expired' };
    return { status: 'valid', row };
  }

  /** Idempotency guard against a double-submit: consuming an already-consumed row is a conflict, not a silent no-op. */
  async consume(rowId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuthToken) : this.repo;
    const row = await repo.findOne({ where: { id: rowId } });
    if (!row || row.consumed_at) {
      throw new ConflictException('This link has already been used');
    }
    await repo.update(rowId, { consumed_at: new Date() });
  }

  async revokeLive(userId: string, purpose: AuthTokenPurpose): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(AuthToken)
      .set({ revoked_at: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('purpose = :purpose', { purpose })
      .andWhere('consumed_at IS NULL')
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  async latest(userId: string, purpose: AuthTokenPurpose): Promise<AuthToken | null> {
    return this.repo.findOne({
      where: { user_id: userId, purpose },
      order: { created_at: 'DESC' },
    });
  }
}
