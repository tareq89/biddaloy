import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { COCKPIT_STEP_REFUSED, CockpitStepTokens } from './cockpit-step-token';

const SECRET = 'step-token-secret-step-token-1234';
const jwtFor = (secret = SECRET) =>
  new JwtService({ secret, signOptions: { issuer: 'biddaloy', algorithm: 'HS256' } });
const config = (previous?: string) =>
  ({
    get: (k: string) =>
      k === 'JWT_SECRET' ? SECRET : k === 'JWT_SECRET_PREVIOUS' ? previous : undefined,
  }) as any;

let cutOff: Date | null = null;
const users = () =>
  ({
    findOne: vi.fn(async ({ where }: any) =>
      where.id === 'u1' ? { id: 'u1', tokens_valid_after: cutOff } : null,
    ),
  }) as any;

describe('CockpitStepTokens', () => {
  const tokens = new CockpitStepTokens(jwtFor(), config(), users());

  it('round-trips the user id and password time for the right step', async () => {
    expect(await tokens.verify(tokens.sign('u1', 'mfa', 42), 'mfa')).toEqual({
      userId: 'u1',
      authAt: 42,
    });
  });

  it('a password reset (cut-off) ends a challenge issued before it, not one issued after', async () => {
    const before = tokens.sign('u1', 'device', Date.now() - 1000);
    cutOff = new Date(Date.now() - 500);
    try {
      const err = await tokens.verify(before, 'device').catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toBe(COCKPIT_STEP_REFUSED);
      expect((await tokens.verify(tokens.sign('u1', 'device'), 'device')).userId).toBe('u1');
    } finally {
      cutOff = null;
    }
  });

  it('refuses a token without the password time, or for a user that is gone', async () => {
    const noAt = jwtFor().sign(
      { sub: 'u1', step: 'mfa' },
      { audience: 'biddaloy:cockpit-mfa', expiresIn: 60 },
    );
    await expect(tokens.verify(noAt, 'mfa')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(tokens.verify(tokens.sign('gone', 'mfa'), 'mfa')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('carries sub, step and at only, in the cockpit-mfa audience, with the right lifetime', () => {
    const decoded: any = jwtFor().decode(tokens.sign('u1', 'device'));
    expect(decoded.aud).toBe('biddaloy:cockpit-mfa');
    expect(Object.keys(decoded).sort()).toEqual(['at', 'aud', 'exp', 'iat', 'iss', 'step', 'sub']);
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
    const old = new CockpitStepTokens(
      jwtFor('old-secret-old-secret-old-secret-1'),
      config(),
      users(),
    );
    const rotated = new CockpitStepTokens(
      jwtFor(),
      config('old-secret-old-secret-old-secret-1'),
      users(),
    );
    expect((await rotated.verify(old.sign('u1', 'enrol'), 'enrol')).userId).toBe('u1');
  });
});
