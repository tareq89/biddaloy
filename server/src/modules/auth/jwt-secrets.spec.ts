import { describe, it, expect } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { jwtVerifySecrets, verifyWithRotation, JWT_ALGORITHM, JWT_ISSUER } from './jwt-secrets';

const CURRENT = 'current-secret-current-secret-current-secret-1';
const PREVIOUS = 'previous-secret-previous-secret-previous-secret';
const cfg = (v: Record<string, string | undefined>) => ({ get: (k: string) => v[k] });
const config = cfg({ JWT_SECRET: CURRENT, JWT_SECRET_PREVIOUS: PREVIOUS });
// Same defaults auth.module.ts registers.
const jwt = new JwtService({
  signOptions: { algorithm: JWT_ALGORITHM, issuer: JWT_ISSUER },
  verifyOptions: { algorithms: [JWT_ALGORITHM], issuer: JWT_ISSUER },
});

describe('jwtVerifySecrets', () => {
  it('returns [current] when no previous secret is set', () => {
    expect(jwtVerifySecrets(cfg({ JWT_SECRET: CURRENT }))).toEqual([CURRENT]);
  });
  it('treats an empty JWT_SECRET_PREVIOUS as unset', () => {
    expect(jwtVerifySecrets(cfg({ JWT_SECRET: CURRENT, JWT_SECRET_PREVIOUS: '' }))).toEqual([
      CURRENT,
    ]);
  });
  it('returns [current, previous] when both are set', () => {
    expect(jwtVerifySecrets(config)).toEqual([CURRENT, PREVIOUS]);
  });
  it('throws when JWT_SECRET is missing', () => {
    expect(() => jwtVerifySecrets(cfg({}))).toThrow('JWT_SECRET is not configured');
  });
});

describe('verifyWithRotation', () => {
  const sign = (secret: string) => jwt.sign({ sub: 'u1' }, { secret });

  it('accepts a token signed with the current secret', async () => {
    expect((await verifyWithRotation<{ sub: string }>(jwt, sign(CURRENT), config)).sub).toBe('u1');
  });
  it('accepts a token signed with the previous secret', async () => {
    expect((await verifyWithRotation<{ sub: string }>(jwt, sign(PREVIOUS), config)).sub).toBe('u1');
  });
  it('reports the real error for a current-secret token, not the fallback one', async () => {
    const expired = jwt.sign(
      { sub: 'u1', exp: Math.floor(Date.now() / 1000) - 60 },
      { secret: CURRENT },
    );
    await expect(verifyWithRotation(jwt, expired, config)).rejects.toThrow('jwt expired');
  });
  it('reports "jwt expired" for an expired previous-secret token', async () => {
    const expired = jwt.sign(
      { sub: 'u1', exp: Math.floor(Date.now() / 1000) - 60 },
      { secret: PREVIOUS },
    );
    await expect(verifyWithRotation(jwt, expired, config)).rejects.toThrow('jwt expired');
  });
  it('rejects a previous-secret token once JWT_SECRET_PREVIOUS is removed', async () => {
    await expect(
      verifyWithRotation(jwt, sign(PREVIOUS), cfg({ JWT_SECRET: CURRENT })),
    ).rejects.toThrow();
  });
  it('rejects a token signed with an unrelated secret', async () => {
    await expect(
      verifyWithRotation(jwt, sign('unrelated-unrelated-unrelated-unrelated-1'), config),
    ).rejects.toThrow();
  });
  it('rejects an HS512 token', async () => {
    const t = new JwtService({}).sign(
      { sub: 'u1' },
      { secret: CURRENT, algorithm: 'HS512', issuer: JWT_ISSUER },
    );
    await expect(verifyWithRotation(jwt, t, config)).rejects.toThrow();
  });
  it('rejects a token without the issuer', async () => {
    const t = new JwtService({}).sign({ sub: 'u1' }, { secret: CURRENT });
    await expect(verifyWithRotation(jwt, t, cfg({ JWT_SECRET: CURRENT }))).rejects.toThrow(
      /issuer/,
    );
  });
});
