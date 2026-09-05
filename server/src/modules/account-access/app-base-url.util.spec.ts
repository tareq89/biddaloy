import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { resolveAppBaseUrl } from './app-base-url.util';

function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('resolveAppBaseUrl', () => {
  it('falls back to localhost outside production when unset', () => {
    expect(resolveAppBaseUrl(fakeConfig({ NODE_ENV: 'test' }))).toBe('http://localhost:5174');
  });

  it('returns a configured HTTP URL outside production', () => {
    expect(
      resolveAppBaseUrl(fakeConfig({ NODE_ENV: 'test', APP_BASE_URL: 'http://staging.example' })),
    ).toBe('http://staging.example');
  });

  it('throws in production when unset', () => {
    expect(() => resolveAppBaseUrl(fakeConfig({ NODE_ENV: 'production' }))).toThrow(
      /must be set in production/,
    );
  });

  it('throws in production when set to a non-HTTPS URL', () => {
    expect(() =>
      resolveAppBaseUrl(
        fakeConfig({ NODE_ENV: 'production', APP_BASE_URL: 'http://app.example.com' }),
      ),
    ).toThrow(/must be an HTTPS URL with a hostname/);
  });

  it('throws in production when the value has no hostname', () => {
    // `https://` alone is what a naive `startsWith('https://')` check would
    // accept, appending `/reset-password?token=...` would then resolve to
    // hostname "reset-password" — the exact host-confusion bug this
    // parse-and-validate step exists to catch. `new URL()` itself rejects
    // this shape outright (no authority), so it surfaces as "not a valid
    // absolute URL" rather than the hostname-specific message.
    expect(() =>
      resolveAppBaseUrl(fakeConfig({ NODE_ENV: 'production', APP_BASE_URL: 'https://' })),
    ).toThrow(/must be a valid absolute URL/);
  });

  it('throws in production when set to a malformed URL', () => {
    expect(() =>
      resolveAppBaseUrl(fakeConfig({ NODE_ENV: 'production', APP_BASE_URL: 'not-a-url' })),
    ).toThrow(/must be a valid absolute URL/);
  });

  it('throws in production when the URL carries credentials, a query, or a fragment', () => {
    for (const value of [
      'https://user:pass@app.example.com',
      'https://app.example.com?x=1',
      'https://app.example.com#frag',
    ]) {
      expect(() =>
        resolveAppBaseUrl(fakeConfig({ NODE_ENV: 'production', APP_BASE_URL: value })),
      ).toThrow(/must be an HTTPS URL with a hostname/);
    }
  });

  it('returns a configured HTTPS URL in production', () => {
    expect(
      resolveAppBaseUrl(
        fakeConfig({ NODE_ENV: 'production', APP_BASE_URL: 'https://app.example.com' }),
      ),
    ).toBe('https://app.example.com');
  });
});
