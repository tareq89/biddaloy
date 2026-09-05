import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { AccessTokenDenylistService } from '../access-token-denylist.service';
import { JwtPayload } from '@biddaloy/shared';

function configServiceWithSecret(secret: string | undefined): ConfigService {
  return { get: () => secret } as unknown as ConfigService;
}

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let mockDenylist: { isRevoked: ReturnType<typeof vi.fn> };

  const users = { findOne: vi.fn() };

  beforeEach(() => {
    users.findOne.mockResolvedValue({ status: 'ACTIVE', credential_version: 0, password_change_required: false });
    mockDenylist = { isRevoked: vi.fn().mockResolvedValue(false) };
    strategy = new JwtStrategy(
      configServiceWithSecret('test-jwt-secret-do-not-use-in-production'),
      mockDenylist as unknown as AccessTokenDenylistService,
      users as any,
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

  it('throws UnauthorizedException when the jti has been denylisted', async () => {
    mockDenylist.isRevoked.mockResolvedValue(true);
    const payload: JwtPayload = {
      sub: 'user-1',
      email: null,
      phone: null,
      memberships: [],
      jti: 'revoked-token',
    };

    await expect(strategy.validate(payload)).rejects.toThrow('Token has been revoked');
    expect(mockDenylist.isRevoked).toHaveBeenCalledWith('revoked-token');
  });

  it.each([null, -1, 0.5, '0', 1])('rejects invalid or stale credential version %s', async (version) => {
    await expect(strategy.validate({ sub: 'user-1', memberships: [], jti: 'jti', credential_version: version } as any)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects reset-purpose tokens even with normal access claims', async () => {
    await expect(strategy.validate({ sub: 'user-1', memberships: [], jti: 'jti', purpose: 'complete_password_reset' } as any)).rejects.toThrow(UnauthorizedException);
  });

  it.each([null, { status: 'INACTIVE', credential_version: 0 }, { status: 'ACTIVE', credential_version: 0, password_change_required: true }])('rejects unusable current account', async (user) => {
    users.findOne.mockResolvedValue(user);
    await expect(strategy.validate({ sub: 'user-1', memberships: [], jti: 'jti' } as any)).rejects.toThrow(UnauthorizedException);
  });

  it('fails closed when the database cannot verify credentials', async () => {
    users.findOne.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(strategy.validate({ sub: 'user-1', memberships: [], jti: 'jti' } as any)).rejects.toThrow('database unavailable');
  });

  it('throws instead of falling back to a default secret when JWT_SECRET is missing', () => {
    expect(
      () =>
        new JwtStrategy(
          configServiceWithSecret(undefined),
          mockDenylist as unknown as AccessTokenDenylistService,
      users as any,
        ),
    ).toThrow('JWT_SECRET is not configured');
  });
});
