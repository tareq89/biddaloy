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

/** `maxAgeMs` is the absolute time left on a refresh; a fresh sign-in gets the full 8 h. */
export function setCockpitRefreshCookie(
  response: Response,
  cookieValue: string,
  maxAgeMs: number = COCKPIT_SESSION_MAX_MS,
): void {
  response.cookie(
    COCKPIT_REFRESH_COOKIE,
    cookieValue,
    options(Math.min(maxAgeMs, COCKPIT_SESSION_MAX_MS)),
  );
}

export function clearCockpitRefreshCookie(response: Response): void {
  response.clearCookie(COCKPIT_REFRESH_COOKIE, options());
}

export function setCockpitDeviceCookie(response: Response, value: string): void {
  response.cookie(COCKPIT_DEVICE_COOKIE, value, options(COCKPIT_DEVICE_MAX_MS));
}
