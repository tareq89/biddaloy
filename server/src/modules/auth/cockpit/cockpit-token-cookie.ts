import { CookieOptions, Response } from 'express';

/** [Epic 98] `__Host-` cookies for the cockpit: Secure, Path=/, no Domain (same reasoning as token-cookie.ts). */
export const COCKPIT_REFRESH_COOKIE = '__Host-cockpit_refresh';
export const COCKPIT_DEVICE_COOKIE = '__Host-cockpit_device';

export const COCKPIT_SESSION_MAX_MS = 8 * 60 * 60_000;
export const COCKPIT_IDLE_MAX_MS = 30 * 60_000;
export const COCKPIT_DEVICE_MAX_MS = 90 * 24 * 60 * 60_000;

function options(maxAgeMs?: number): CookieOptions {
  const base: CookieOptions = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };
  return maxAgeMs === undefined ? base : { ...base, maxAge: maxAgeMs };
}

/*
 * CodeQL (js/clear-text-storage-of-sensitive-data) flags both cookies below because their value
 * comes from a variable named `secret`. That is the design, not a leak: each cookie IS the bearer
 * credential (a refresh token `id.secret`, a remembered-device secret), random 256-bit values that
 * are never password material. The server keeps only their SHA-256 hash (refresh-token.service.ts,
 * cockpit-device.service.ts), and the browser keeps them httpOnly + Secure + SameSite=Strict under
 * `__Host-`, so page script and other hosts cannot read them. Same reasoning as token-cookie.ts.
 */

/** `maxAgeMs` is the absolute time left on a refresh; a fresh sign-in gets the full 8 h. */
export function setCockpitRefreshCookie(
  response: Response,
  cookieValue: string,
  maxAgeMs: number = COCKPIT_SESSION_MAX_MS,
): void {
  response.cookie(
    COCKPIT_REFRESH_COOKIE,
    cookieValue, // codeql[js/clear-text-storage-of-sensitive-data]
    options(Math.min(maxAgeMs, COCKPIT_SESSION_MAX_MS)),
  );
}

export function clearCockpitRefreshCookie(response: Response): void {
  response.clearCookie(COCKPIT_REFRESH_COOKIE, options());
}

export function setCockpitDeviceCookie(response: Response, value: string): void {
  response.cookie(
    COCKPIT_DEVICE_COOKIE,
    value, // codeql[js/clear-text-storage-of-sensitive-data]
    options(COCKPIT_DEVICE_MAX_MS),
  );
}
