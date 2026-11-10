import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@biddaloy/shared';
import { CockpitJwtStrategy } from './cockpit-jwt.strategy';
import { JwtStrategy } from './jwt.strategy';
import {
  ACCESS_TOKEN_AUDIENCE,
  COCKPIT_ACCESS_TOKEN_AUDIENCE,
  COCKPIT_MFA_TOKEN_AUDIENCE,
  JWT_ISSUER,
} from '../jwt-secrets';

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
    findOne = vi.fn().mockResolvedValue({
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
});

/**
 * Real tokens through the strategies' real passport-jwt path (authenticate), so the
 * algorithm, issuer, audience and secret pins are exercised rather than read from config.
 */
describe('audience separation with real tokens', () => {
  const SECRET = 'test-secret-test-secret-test-1234';
  const jwt = new JwtService({ secret: SECRET, signOptions: { issuer: JWT_ISSUER } });
  const app = { sub: 'u1', jti: 'j1', memberships: [{ tenantId: 't', role: 'ADMIN' }] };
  const cockpit = { sub: 'u1', jti: 'j1', fam: 'f1', typ: 'cockpit', iat_ms: Date.now() };
  const sign = (payload: object, audience: string, secret = SECRET) =>
    jwt.sign(payload, { audience, secret, expiresIn: 60 });

  const owner = {
    id: 'u1',
    status: UserStatus.ACTIVE,
    deleted_at: null,
    tokens_valid_after: null,
  };
  const cockpitStrategy = new CockpitJwtStrategy(
    config,
    jwt,
    { isRevoked: vi.fn().mockResolvedValue(false) } as any,
    { touch: vi.fn().mockResolvedValue(undefined) } as any,
    { findOne: vi.fn().mockResolvedValue(owner) } as any,
    { count: vi.fn().mockResolvedValue(1) } as any,
  );
  const appStrategy = new JwtStrategy(
    config,
    jwt,
    { isRevoked: vi.fn().mockResolvedValue(false) } as any,
    { findOne: vi.fn().mockResolvedValue(owner) } as any,
    // The app strategy refuses an owner's app token; this spec's app token is not an owner's.
    { exists: vi.fn().mockResolvedValue(false) } as any,
  );

  function run(strategy: any, token: string): Promise<'accepted' | 'refused'> {
    return new Promise((resolve) => {
      const s = Object.create(strategy);
      s.success = () => resolve('accepted');
      s.fail = () => resolve('refused');
      s.error = () => resolve('refused');
      s.authenticate({ headers: { authorization: `Bearer ${token}` } });
    });
  }

  it('the cockpit strategy accepts only a cockpit-access token', async () => {
    expect(await run(cockpitStrategy, sign(cockpit, COCKPIT_ACCESS_TOKEN_AUDIENCE))).toBe(
      'accepted',
    );
    expect(await run(cockpitStrategy, sign(cockpit, COCKPIT_MFA_TOKEN_AUDIENCE))).toBe('refused');
    expect(await run(cockpitStrategy, sign(app, ACCESS_TOKEN_AUDIENCE))).toBe('refused');
  });

  it('the app strategy refuses cockpit-access and cockpit-mfa tokens', async () => {
    expect(await run(appStrategy, sign(app, ACCESS_TOKEN_AUDIENCE))).toBe('accepted');
    expect(await run(appStrategy, sign(cockpit, COCKPIT_ACCESS_TOKEN_AUDIENCE))).toBe('refused');
    expect(await run(appStrategy, sign(cockpit, COCKPIT_MFA_TOKEN_AUDIENCE))).toBe('refused');
  });

  it('a wrong secret, a wrong issuer and an unsigned token are refused', async () => {
    const aud = COCKPIT_ACCESS_TOKEN_AUDIENCE;
    expect(await run(cockpitStrategy, sign(cockpit, aud, 'another-secret-another-secret-12'))).toBe(
      'refused',
    );
    const otherIssuer = new JwtService({ secret: SECRET, signOptions: { issuer: 'evil' } });
    expect(
      await run(cockpitStrategy, otherIssuer.sign(cockpit, { audience: aud, expiresIn: 60 })),
    ).toBe('refused');
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ ...cockpit, iss: JWT_ISSUER, aud }),
    ).toString('base64url')}.`;
    expect(await run(cockpitStrategy, none)).toBe('refused');
  });
});
