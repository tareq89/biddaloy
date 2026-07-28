import { describe, it, expect, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { JwtPayload } from '@beton-boi/shared';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    strategy = new JwtStrategy();
  });

  it('returns the payload unchanged when sub and memberships are present', async () => {
    const payload: JwtPayload = {
      sub: 'user-1',
      email: 'test@test.com',
      phone: null,
      memberships: [{ tenantId: 'tenant-1', role: 'ADMIN' as any }],
    };

    const result = await strategy.validate(payload);

    expect(result).toEqual(payload);
  });

  it('throws UnauthorizedException when sub is missing', async () => {
    const payload = { memberships: [] } as unknown as JwtPayload;

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(payload)).rejects.toThrow('Invalid token payload');
  });

  it('throws UnauthorizedException when memberships is missing', async () => {
    const payload = { sub: 'user-1' } as unknown as JwtPayload;

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(payload)).rejects.toThrow('Invalid token payload');
  });
});
