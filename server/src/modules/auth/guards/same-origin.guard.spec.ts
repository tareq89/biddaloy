import { describe, it, expect } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { isOriginAllowed, requestOrigin, SameOriginGuard } from './same-origin.guard';

function fakeRequest(overrides: { origin?: string; protocol?: string; host?: string } = {}): any {
  const host = overrides.host ?? 'app.example.com';
  return {
    protocol: overrides.protocol ?? 'https',
    headers: overrides.origin !== undefined ? { origin: overrides.origin } : {},
    get: (name: string) => (name.toLowerCase() === 'host' ? host : undefined),
  };
}

function contextFor(request: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('isOriginAllowed', () => {
  it('passes through when no Origin header is present — not a request shape a browser sends for state-changing methods', () => {
    expect(isOriginAllowed(undefined, 'https://app.example.com')).toBe(true);
  });

  it('allows a matching same-origin Origin header', () => {
    expect(isOriginAllowed('https://app.example.com', 'https://app.example.com')).toBe(true);
  });

  it('rejects a cross-origin Origin header', () => {
    expect(isOriginAllowed('https://evil.example.com', 'https://app.example.com')).toBe(false);
  });

  it('rejects a same-hostname mismatch on scheme or port — Origin comparison is exact', () => {
    expect(isOriginAllowed('http://app.example.com', 'https://app.example.com')).toBe(false);
    expect(isOriginAllowed('https://app.example.com:8443', 'https://app.example.com')).toBe(false);
  });
});

describe('requestOrigin', () => {
  it('combines protocol and Host header', () => {
    expect(requestOrigin(fakeRequest({ protocol: 'https', host: 'app.example.com' }))).toBe(
      'https://app.example.com',
    );
  });

  it('reflects the request protocol even without an explicit override (e.g. http in dev)', () => {
    expect(requestOrigin(fakeRequest({ protocol: 'http', host: 'localhost:3000' }))).toBe('http://localhost:3000');
  });
});

describe('SameOriginGuard', () => {
  const guard = new SameOriginGuard();

  it('allows a request with no Origin header', () => {
    const request = fakeRequest({ host: 'app.example.com' });
    expect(guard.canActivate(contextFor(request))).toBe(true);
  });

  it('allows a same-origin request', () => {
    const request = fakeRequest({ origin: 'https://app.example.com', host: 'app.example.com' });
    expect(guard.canActivate(contextFor(request))).toBe(true);
  });

  it('throws ForbiddenException for a cross-origin request', () => {
    const request = fakeRequest({ origin: 'https://evil.example.com', host: 'app.example.com' });
    expect(() => guard.canActivate(contextFor(request))).toThrow(ForbiddenException);
  });
});
