import { describe, it, expect, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { JwtPayload } from '@beton-boi/shared';

function configServiceWithSecret(secret: string | undefined): ConfigService {
  return { get: () => secret } as unknown as ConfigService;
}

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    strategy = new JwtStrategy(configServiceWithSecret('test-jwt-secret-do-not-use-in-production'));
  });

  it('returns the payload unchanged when sub and memberships are present', async () => {
    const payload: JwtPayload = {
      sub: 'user-1',
      email: 'test@test.com',
      phone: null,
      memberships: [{ tenantId: 'tenant-1', role: 'ADMIN' as any }],
    };

    const result = await strategy.validate(payload);

    // A well-formed payload must pass through untouched — it becomes req.user for every guard downstream.
    expect(result).toEqual(payload);
  });

  it('throws UnauthorizedException when sub is missing', async () => {
    const payload = { memberships: [] } as unknown as JwtPayload;

    // A token without a subject can't be tied to a user — must be rejected, not passed through.
    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(payload)).rejects.toThrow('Invalid token payload');
  });

  it('throws UnauthorizedException when memberships is missing', async () => {
    const payload = { sub: 'user-1' } as unknown as JwtPayload;

    // Without memberships, ContextGuard has nothing to resolve a tenant/role from — reject early.
    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(payload)).rejects.toThrow('Invalid token payload');
  });

  it('throws instead of falling back to a default secret when JWT_SECRET is missing', () => {
    expect(() => new JwtStrategy(configServiceWithSecret(undefined))).toThrow(
      'JWT_SECRET is not configured',
    );
  });
});
