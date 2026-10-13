import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { AccessTokenDenylistService } from '../access-token-denylist.service';
import { JwtPayload, UserStatus } from '@biddaloy/shared';
import type { Repository } from 'typeorm';
import type { User } from '../../users/entities/user.entity';

function configServiceWithSecret(secret: string | undefined): ConfigService {
  return { get: () => secret } as unknown as ConfigService;
}

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let mockDenylist: { isRevoked: ReturnType<typeof vi.fn> };
  let findOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDenylist = { isRevoked: vi.fn().mockResolvedValue(false) };
    findOne = vi.fn().mockResolvedValue({
      id: 'user-1',
      status: UserStatus.ACTIVE,
      deleted_at: null,
      tokens_valid_after: null,
    });
    const userRepo = { findOne } as unknown as Repository<User>;
    strategy = new JwtStrategy(
      configServiceWithSecret('test-jwt-secret-do-not-use-in-production'),
      mockDenylist as unknown as AccessTokenDenylistService,
      userRepo,
    );
  });

  it('returns the payload unchanged when sub, memberships, and jti are present', async () => {
    const payload: JwtPayload = {
      sub: 'user-1',
      email: 'test@test.com',
      phone: null,
      memberships: [{ tenantId: 'tenant-1', role: 'ADMIN' as any, name: 'Greenview School' }],
      jti: 'token-1',
    };

    const result = await strategy.validate(payload);

    // A well-formed payload must pass through untouched — it becomes req.user for every guard downstream.
    expect(result).toEqual(payload);
  });

  it('throws UnauthorizedException when sub is missing', async () => {
    const payload = { memberships: [], jti: 'token-1' } as unknown as JwtPayload;

    // A token without a subject can't be tied to a user — must be rejected, not passed through.
    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(payload)).rejects.toThrow('Invalid token payload');
  });

  it('throws UnauthorizedException when memberships is missing', async () => {
    const payload = { sub: 'user-1', jti: 'token-1' } as unknown as JwtPayload;

    // Without memberships, ContextGuard has nothing to resolve a tenant/role from — reject early.
    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(payload)).rejects.toThrow('Invalid token payload');
  });

  it('throws UnauthorizedException when jti is missing', async () => {
    const payload = { sub: 'user-1', memberships: [] } as unknown as JwtPayload;

    // Without a jti, there's nothing to check against the denylist —
    // logout-all/reuse-detection revocation couldn't have applied to it.
    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(payload)).rejects.toThrow('Invalid token payload');
  });

  it('throws UnauthorizedException when the denylist says revoked for the payload', async () => {
    mockDenylist.isRevoked.mockResolvedValue(true);
    const payload: JwtPayload = {
      sub: 'user-1',
      email: null,
      phone: null,
      memberships: [],
      jti: 'revoked-token',
    };

    await expect(strategy.validate(payload)).rejects.toThrow('Token has been revoked');
    expect(mockDenylist.isRevoked).toHaveBeenCalledWith(payload);
  });

  it('throws UnauthorizedException when the payload carries a single-purpose claim', async () => {
    const payload = {
      sub: 'user-1',
      memberships: [],
      jti: 'token-1',
      purpose: 'complete_password_reset',
    } as unknown as JwtPayload;

    // A challenge token minted for one specific operation must never be
    // accepted as a general-purpose access token, even if it otherwise has
    // a valid sub/memberships/jti shape.
    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(payload)).rejects.toThrow('Invalid token payload');
  });

  describe('session cut-off (75.2)', () => {
    const payload = (extra: Partial<JwtPayload> = {}): JwtPayload => ({
      sub: 'user-1',
      email: null,
      phone: null,
      memberships: [],
      jti: 'token-1',
      ...extra,
    });
    const row = (extra: Record<string, unknown>) => ({
      id: 'user-1',
      status: UserStatus.ACTIVE,
      deleted_at: null,
      tokens_valid_after: null,
      ...extra,
    });
    const cut = new Date('2026-01-01T00:00:10.500Z'); // 1767225610 s

    it('returns the payload when tokens_valid_after is NULL', async () => {
      const p = payload({ iat: 1 });
      await expect(strategy.validate(p)).resolves.toEqual(p);
    });

    it('401 when iat is before tokens_valid_after', async () => {
      findOne.mockResolvedValue(row({ tokens_valid_after: cut }));
      await expect(strategy.validate(payload({ iat: 1767225609 }))).rejects.toThrow(
        'Token has been revoked',
      );
    });

    it('allows a token with iat in the same second as tokens_valid_after', async () => {
      findOne.mockResolvedValue(row({ tokens_valid_after: cut }));
      const p = payload({ iat: 1767225610 });
      await expect(strategy.validate(p)).resolves.toEqual(p);
    });

    it('uses iat_ms when present: older ms is refused, newer ms is allowed', async () => {
      findOne.mockResolvedValue(row({ tokens_valid_after: cut }));
      await expect(
        strategy.validate(payload({ iat: 1767225610, iat_ms: cut.getTime() - 1 })),
      ).rejects.toThrow(UnauthorizedException);
      const ok = payload({ iat: 1767225610, iat_ms: cut.getTime() + 1 });
      await expect(strategy.validate(ok)).resolves.toEqual(ok);
    });

    it.each([
      ['missing', null],
      ['soft-deleted', row({ deleted_at: new Date() })],
      ['SUSPENDED', row({ status: UserStatus.SUSPENDED })],
      ['INACTIVE', row({ status: UserStatus.INACTIVE })],
    ])('401 when the user row is %s', async (_label, found) => {
      findOne.mockResolvedValue(found);
      await expect(strategy.validate(payload({ iat: 1 }))).rejects.toThrow(UnauthorizedException);
    });
  });

  it('throws instead of falling back to a default secret when JWT_SECRET is missing', () => {
    expect(
      () =>
        new JwtStrategy(
          configServiceWithSecret(undefined),
          mockDenylist as unknown as AccessTokenDenylistService,
          { findOne } as unknown as Repository<User>,
        ),
    ).toThrow('JWT_SECRET is not configured');
  });
});
