import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import {
  REFRESH_TOKEN_COOKIE,
  buildRefreshTokenCookieOptions,
  buildRefreshTokenClearCookieOptions,
  setRefreshCookie,
} from './token-cookie';

describe('REFRESH_TOKEN_COOKIE', () => {
  it('carries the __Host- prefix', () => {
    expect(REFRESH_TOKEN_COOKIE).toBe('__Host-refresh_token');
  });
});

describe('buildRefreshTokenCookieOptions', () => {
  it("is always httpOnly, Secure, SameSite=Strict, and Path=/ — the __Host- prefix's own requirements", () => {
    const options = buildRefreshTokenCookieOptions(1000);
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('strict');
    expect(options.path).toBe('/');
  });

  it('never sets a Domain attribute — also required by __Host-', () => {
    expect(buildRefreshTokenCookieOptions(1000)).not.toHaveProperty('domain');
  });

  it('passes maxAge through unchanged', () => {
    expect(buildRefreshTokenCookieOptions(123_456).maxAge).toBe(123_456);
    expect(buildRefreshTokenCookieOptions(0).maxAge).toBe(0);
  });
});

describe('buildRefreshTokenClearCookieOptions', () => {
  it("matches the setting cookie's flags so the browser actually clears it", () => {
    const options = buildRefreshTokenClearCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('strict');
    expect(options.path).toBe('/');
  });

  it('omits maxAge — clearing a cookie is about deletion, not expiry', () => {
    expect(buildRefreshTokenClearCookieOptions()).not.toHaveProperty('maxAge');
  });
});

describe('setRefreshCookie', () => {
  it('sets the refresh cookie on the response with the __Host- flags', () => {
    const cookie = vi.fn();
    const response = { cookie } as unknown as Response;
    const expiresAt = new Date(Date.now() + 60_000);

    setRefreshCookie(response, { cookieValue: 'id.secret', expiresAt });

    expect(cookie).toHaveBeenCalledTimes(1);
    const [name, value, options] = cookie.mock.calls[0] as [
      string,
      string,
      ReturnType<typeof buildRefreshTokenCookieOptions>,
    ];
    expect(name).toBe(REFRESH_TOKEN_COOKIE);
    expect(value).toBe('id.secret');
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe('strict');
  });

  it('accepts an explicit ttlMs override instead of deriving maxAge from expiresAt', () => {
    const cookie = vi.fn();
    const response = { cookie } as unknown as Response;

    setRefreshCookie(response, { cookieValue: 'id.secret', expiresAt: new Date(0) }, 5000);

    const [, , options] = cookie.mock.calls[0] as [string, string, { maxAge: number }];
    expect(options.maxAge).toBe(5000);
  });
});
