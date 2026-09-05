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
    ).toThrow(/must be an HTTPS URL in production/);
  });

  it('returns a configured HTTPS URL in production', () => {
    expect(
      resolveAppBaseUrl(
        fakeConfig({ NODE_ENV: 'production', APP_BASE_URL: 'https://app.example.com' }),
      ),
    ).toBe('https://app.example.com');
  });
});
