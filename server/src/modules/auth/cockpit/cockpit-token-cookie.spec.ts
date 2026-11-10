import { describe, it, expect, vi } from 'vitest';
import {
  COCKPIT_DEVICE_COOKIE,
  COCKPIT_DEVICE_MAX_MS,
  COCKPIT_REFRESH_COOKIE,
  COCKPIT_SESSION_MAX_MS,
  clearCockpitRefreshCookie,
  setCockpitDeviceCookie,
  setCockpitRefreshCookie,
} from './cockpit-token-cookie';

describe('cockpit cookies', () => {
  it('refresh cookie is __Host-, httpOnly, Secure, Strict, Path=/ and lasts 8 h', () => {
    const res = { cookie: vi.fn() } as any;
    setCockpitRefreshCookie(res, 'v');
    expect(res.cookie).toHaveBeenCalledWith(COCKPIT_REFRESH_COOKIE, 'v', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: COCKPIT_SESSION_MAX_MS,
    });
    expect(COCKPIT_REFRESH_COOKIE.startsWith('__Host-')).toBe(true);
    expect(COCKPIT_SESSION_MAX_MS).toBe(8 * 3600_000);
  });

  it('device cookie lasts 90 days and no Domain is ever set', () => {
    const res = { cookie: vi.fn() } as any;
    setCockpitDeviceCookie(res, 'd');
    const [name, , opts] = res.cookie.mock.calls[0];
    expect(name).toBe(COCKPIT_DEVICE_COOKIE);
    expect(opts.maxAge).toBe(COCKPIT_DEVICE_MAX_MS);
    expect(opts).not.toHaveProperty('domain');
  });

  it('clear uses the same attributes without maxAge', () => {
    const res = { clearCookie: vi.fn() } as any;
    clearCockpitRefreshCookie(res);
    expect(res.clearCookie.mock.calls[0][0]).toBe(COCKPIT_REFRESH_COOKIE);
    expect(res.clearCookie.mock.calls[0][1]).not.toHaveProperty('maxAge');
  });
});
