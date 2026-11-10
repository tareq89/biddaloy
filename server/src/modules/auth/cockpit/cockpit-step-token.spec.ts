import { describe, it, expect } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CockpitStepTokens } from './cockpit-step-token';

const SECRET = 'step-token-secret-step-token-1234';
const jwtFor = (secret = SECRET) =>
  new JwtService({ secret, signOptions: { issuer: 'biddaloy', algorithm: 'HS256' } });
const config = (previous?: string) =>
  ({
    get: (k: string) =>
      k === 'JWT_SECRET' ? SECRET : k === 'JWT_SECRET_PREVIOUS' ? previous : undefined,
  }) as any;

describe('CockpitStepTokens', () => {
  const tokens = new CockpitStepTokens(jwtFor(), config());

  it('round-trips the user id for the right step', async () => {
    expect(await tokens.verify(tokens.sign('u1', 'mfa'), 'mfa')).toBe('u1');
  });

  it('carries sub and step only, in the cockpit-mfa audience, with the right lifetime', () => {
    const decoded: any = jwtFor().decode(tokens.sign('u1', 'device'));
    expect(decoded.aud).toBe('biddaloy:cockpit-mfa');
    expect(Object.keys(decoded).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'step', 'sub']);
    expect(decoded.exp - decoded.iat).toBe(600);
    const lifetimes = ['mfa', 'enrol'].map((s) => {
      const d: any = jwtFor().decode(tokens.sign('u1', s as any));
      return d.exp - d.iat;
    });
    expect(lifetimes).toEqual([300, 900]);
  });

  it('refuses a token for another step, an app token, garbage, and an expired token with one message', async () => {
    const messages = new Set<string>();
    const attempts: Array<[string | undefined, 'mfa' | 'device' | 'enrol']> = [
      [tokens.sign('u1', 'mfa'), 'device'],
      [jwtFor().sign({ sub: 'u1', step: 'mfa' }, { audience: 'biddaloy:access' }), 'mfa'],
      ['garbage', 'mfa'],
      [undefined, 'mfa'],
      [
        jwtFor().sign(
          { sub: 'u1', step: 'mfa' },
          { audience: 'biddaloy:cockpit-mfa', expiresIn: -10 },
        ),
        'mfa',
      ],
    ];
    for (const [token, step] of attempts) {
      const err = await tokens.verify(token, step).catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedException);
      messages.add(err.message);
    }
    expect(messages.size).toBe(1);
  });

  it('accepts a token signed with the previous secret during rotation', async () => {
    const old = new CockpitStepTokens(jwtFor('old-secret-old-secret-old-secret-1'), config());
    const rotated = new CockpitStepTokens(jwtFor(), config('old-secret-old-secret-old-secret-1'));
    expect(await rotated.verify(old.sign('u1', 'enrol'), 'enrol')).toBe('u1');
  });
});
