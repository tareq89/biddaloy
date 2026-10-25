import { describe, it, expect } from 'vitest';
import { buildHelmetOptions } from './security-headers';

describe('buildHelmetOptions', () => {
  it('enables HSTS with a one-year max-age and includeSubDomains in production', () => {
    const options = buildHelmetOptions('production');

    expect(options.hsts).toEqual({ maxAge: 31536000, includeSubDomains: true });
  });

  it('disables HSTS outside production', () => {
    expect(buildHelmetOptions('development').hsts).toBe(false);
    expect(buildHelmetOptions('test').hsts).toBe(false);
    expect(buildHelmetOptions(undefined).hsts).toBe(false);
  });

  it('adds upgrade-insecure-requests to the CSP only in production', () => {
    const prodDirectives = buildHelmetOptions('production').contentSecurityPolicy as any;
    const devDirectives = buildHelmetOptions('development').contentSecurityPolicy as any;

    expect(prodDirectives.directives.upgradeInsecureRequests).toEqual([]);
    expect(devDirectives.directives.upgradeInsecureRequests).toBeUndefined();
  });

  it('restricts the CSP to same-origin plus Turnstile, with no defaults merged in', () => {
    const { contentSecurityPolicy } = buildHelmetOptions('production') as any;

    expect(contentSecurityPolicy.useDefaults).toBe(false);
    expect(contentSecurityPolicy.directives).toMatchObject({
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameSrc: ['https://challenges.cloudflare.com'],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
      styleSrc: ["'self'"],
    });
  });

  it('lets the browser reach only the Sentry DSN origin, and only when one is set', () => {
    const csp = (dsn?: string) =>
      (buildHelmetOptions('production', dsn) as any).contentSecurityPolicy.directives;
    expect(csp('https://key@o1.ingest.sentry.io/42').connectSrc).toEqual([
      "'self'",
      'https://o1.ingest.sentry.io',
    ]);
    expect(csp('').connectSrc).toBeUndefined();
    expect(csp('not a url').connectSrc).toBeUndefined();
  });

  it('sets referrerPolicy to no-referrer and frameguard to deny', () => {
    const options = buildHelmetOptions('production');

    expect(options.referrerPolicy).toEqual({ policy: 'no-referrer' });
    expect(options.frameguard).toEqual({ action: 'deny' });
  });
});
