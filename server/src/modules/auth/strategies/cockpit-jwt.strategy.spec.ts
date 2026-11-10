import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@biddaloy/shared';
import { CockpitJwtStrategy } from './cockpit-jwt.strategy';

const config = {
  get: (k: string) => (k === 'JWT_SECRET' ? 'test-secret-test-secret-test-1234' : undefined),
} as any;
const good = { sub: 'u1', jti: 'j1', fam: 'f1', typ: 'cockpit', iat_ms: Date.now() };

describe('CockpitJwtStrategy.validate', () => {
  let denylist: { isRevoked: ReturnType<typeof vi.fn> };
  let findOne: ReturnType<typeof vi.fn>;
  let count: ReturnType<typeof vi.fn>;
  let touch: ReturnType<typeof vi.fn>;
  let strategy: CockpitJwtStrategy;

  beforeEach(() => {
    denylist = { isRevoked: vi.fn().mockResolvedValue(false) };
    findOne = vi
      .fn()
      .mockResolvedValue({
        id: 'u1',
        status: UserStatus.ACTIVE,
        deleted_at: null,
        tokens_valid_after: null,
      });
    count = vi.fn().mockResolvedValue(1);
    touch = vi.fn().mockResolvedValue(undefined);
    strategy = new CockpitJwtStrategy(
      config,
      new JwtService({}),
      denylist as any,
      { touch } as any,
      { findOne } as any,
      { count } as any,
    );
  });

  async function refusal(payload: any): Promise<string> {
    const err = await strategy.validate(payload).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    return (err as UnauthorizedException).message;
  }

  it('returns the principal and renews the idle key', async () => {
    expect(await strategy.validate(good)).toEqual({
      sub: 'u1',
      jti: 'j1',
      fam: 'f1',
      typ: 'cockpit',
    });
    expect(touch).toHaveBeenCalledWith('f1');
  });

  it('every refusal is a 401 with the same body', async () => {
    const bodies = new Set<string>();
    bodies.add(await refusal({ ...good, fam: undefined })); // missing fam
    bodies.add(await refusal({ ...good, typ: 'access' })); // wrong typ

    findOne.mockResolvedValueOnce({ id: 'u1', status: UserStatus.SUSPENDED, deleted_at: null });
    bodies.add(await refusal(good)); // locked owner

    count.mockResolvedValueOnce(0);
    bodies.add(await refusal(good)); // no platform_admins row

    findOne.mockResolvedValueOnce({
      id: 'u1',
      status: UserStatus.ACTIVE,
      deleted_at: null,
      tokens_valid_after: new Date(good.iat_ms + 5000),
    });
    bodies.add(await refusal(good)); // stale tokens_valid_after

    denylist.isRevoked.mockResolvedValueOnce(true);
    bodies.add(await refusal(good)); // denylisted jti

    expect(bodies.size).toBe(1);
  });

  it('a session the idle/absolute clock ended is refused by touch', async () => {
    touch.mockRejectedValueOnce(new UnauthorizedException('ended'));
    await expect(strategy.validate(good)).rejects.toThrow(UnauthorizedException);
  });

  it('is pinned to the cockpit audience (an app token cannot pass)', () => {
    expect((strategy as any)._verifOpts.audience).toBe('biddaloy:cockpit');
  });
});
