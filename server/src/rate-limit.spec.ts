import { describe, it, expect } from 'vitest';
import { resolveDefaultRateLimit, STRICT_RATE_LIMIT } from './rate-limit';

describe('resolveDefaultRateLimit', () => {
  it('defaults to 100 requests per 60s when unset', () => {
    expect(resolveDefaultRateLimit(undefined, undefined)).toEqual({ limit: 100, ttl: 60_000 });
  });

  it('uses the env-provided limit and ttl when set', () => {
    expect(resolveDefaultRateLimit('250', '30000')).toEqual({ limit: 250, ttl: 30_000 });
  });

  it('allows overriding just one of the two', () => {
    expect(resolveDefaultRateLimit('10', undefined)).toEqual({ limit: 10, ttl: 60_000 });
    expect(resolveDefaultRateLimit(undefined, '5000')).toEqual({ limit: 100, ttl: 5_000 });
  });
});

describe('STRICT_RATE_LIMIT', () => {
  // Pins the exact contract for the expensive-route override (bulk upload,
  // fee generation, bulk reminders, invoice creation) — a bump to e.g.
  // limit: 6 or ttl: 1 should fail this test, not slip through unnoticed.
  //
  // Note this is only stricter than the *unconfigured* default (100/60s).
  // An operator setting RATE_LIMIT_DEFAULT_LIMIT to 5 or below would make
  // the override a no-op — an operational misconfiguration risk this test
  // can't catch, since it depends on runtime env, not code.
  it('is exactly five requests per 60s', () => {
    expect(STRICT_RATE_LIMIT).toEqual({ limit: 5, ttl: 60_000 });
  });

  it('is tighter than the unconfigured default tier', () => {
    const defaultTier = resolveDefaultRateLimit(undefined, undefined);

    expect(STRICT_RATE_LIMIT.limit).toBeLessThan(defaultTier.limit);
  });
});
