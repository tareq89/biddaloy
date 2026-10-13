import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { buildRateLimitTracker } from './rate-limit-tracker';

function fakeJwtService(behavior: { verifyAsync: (token: string) => Promise<any> }) {
  return { verifyAsync: vi.fn(behavior.verifyAsync) } as any;
}

describe('buildRateLimitTracker', () => {
  const saved = { s: process.env.JWT_SECRET, p: process.env.JWT_SECRET_PREVIOUS };
  beforeAll(() => {
    process.env.JWT_SECRET = 'current-secret-current-secret-current-secret-1';
    delete process.env.JWT_SECRET_PREVIOUS;
  });
  afterAll(() => {
    if (saved.s === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = saved.s;
    if (saved.p === undefined) delete process.env.JWT_SECRET_PREVIOUS;
    else process.env.JWT_SECRET_PREVIOUS = saved.p;
  });

  it('keys a token signed with the previous secret as user:<sub> (rotation)', async () => {
    const previous = 'previous-secret-previous-secret-previous-secret';
    process.env.JWT_SECRET_PREVIOUS = previous;
    try {
      const real = new JwtService({});
      const tracker = buildRateLimitTracker(real);
      const good = real.sign({ sub: 'user-9' }, { secret: previous });
      expect(await tracker({ headers: { authorization: `Bearer ${good}` }, ip: '1.1.1.1' })).toBe(
        'user:user-9',
      );
      const bad = real.sign(
        { sub: 'user-9' },
        { secret: 'unrelated-unrelated-unrelated-unrelated-1' },
      );
      expect(await tracker({ headers: { authorization: `Bearer ${bad}` }, ip: '1.1.1.1' })).toBe(
        'ip:1.1.1.1',
      );
    } finally {
      delete process.env.JWT_SECRET_PREVIOUS;
    }
  });

  it("keys by the JWT's sub when a valid Bearer token is present", async () => {
    const jwtService = fakeJwtService({ verifyAsync: async () => ({ sub: 'user-123' }) });
    const tracker = buildRateLimitTracker(jwtService);

    const key = await tracker({
      headers: { authorization: 'Bearer a.valid.token' },
      ip: '1.2.3.4',
    });

    expect(key).toBe('user:user-123');
  });

  it('falls back to IP when there is no Authorization header', async () => {
    const jwtService = fakeJwtService({ verifyAsync: async () => ({ sub: 'user-123' }) });
    const tracker = buildRateLimitTracker(jwtService);

    const key = await tracker({ headers: {}, ip: '1.2.3.4' });

    expect(key).toBe('ip:1.2.3.4');
  });

  it("falls back to IP when the Authorization header isn't a Bearer token", async () => {
    const jwtService = fakeJwtService({ verifyAsync: async () => ({ sub: 'user-123' }) });
    const tracker = buildRateLimitTracker(jwtService);

    const key = await tracker({ headers: { authorization: 'Basic dXNlcjpwYXNz' }, ip: '1.2.3.4' });

    expect(key).toBe('ip:1.2.3.4');
  });

  it('falls back to IP when the token fails verification', async () => {
    const jwtService = fakeJwtService({
      verifyAsync: async () => {
        throw new Error('invalid signature');
      },
    });
    const tracker = buildRateLimitTracker(jwtService);

    const key = await tracker({ headers: { authorization: 'Bearer garbage' }, ip: '5.6.7.8' });

    expect(key).toBe('ip:5.6.7.8');
  });

  it('ignores an X-Device-Key header entirely — bucketing on it would let a caller mint a fresh bucket per request', async () => {
    const jwtService = fakeJwtService({ verifyAsync: async () => ({}) });
    const tracker = buildRateLimitTracker(jwtService);

    const key = await tracker({
      headers: { 'x-device-key': 'bd_dev_a-fresh-value-every-request' },
      ip: '1.2.3.4',
    });

    expect(key).toBe('ip:1.2.3.4');
  });

  it('falls back to IP when the verified payload has no sub', async () => {
    const jwtService = fakeJwtService({ verifyAsync: async () => ({}) });
    const tracker = buildRateLimitTracker(jwtService);

    const key = await tracker({
      headers: { authorization: 'Bearer a.valid.token' },
      ip: '9.9.9.9',
    });

    expect(key).toBe('ip:9.9.9.9');
  });
});
