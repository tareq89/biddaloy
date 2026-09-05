import { CookieOptions, Response } from 'express';

/**
 * The `__Host-` prefix is a browser-enforced guarantee, not just a naming
 * convention: a cookie named this way is only accepted by the browser if it
 * also has `Secure`, `Path=/`, and no `Domain` attribute — which rules out a
 * compromised sibling subdomain (or a parent-domain cookie) ever shadowing
 * or overwriting this one. See #48's plan for why this replaced the
 * previous scheme of a plain name scoped to `/api/v1/auth` (path-scoping
 * reduces which requests carry the cookie, but doesn't stop another origin
 * on the same parent domain from setting a same-named cookie that wins).
 */
export const REFRESH_TOKEN_COOKIE = '__Host-refresh_token';

/**
 * `__Host-` requires `Secure` unconditionally — there's no "secure except
 * in dev" option once the prefix is in use; the browser silently drops the
 * whole Set-Cookie header otherwise. This still works for local HTTP dev
 * because Chrome and Firefox both treat `http://localhost` (and 127.0.0.1)
 * as a "potentially trustworthy origin", so Secure cookies are set and sent
 * normally there despite the connection being plain HTTP — but only for
 * that literal hostname. Local dev must be served via http://localhost
 * (as the README's Quick Start already has it), not a LAN IP or a custom
 * local hostname, or the browser drops this cookie silently and refresh/
 * logout stop working with no visible error.
 *
 * `__Host-` also requires Path=/ (see above) — the previous path-scoped
 * cookie could not carry this prefix at all.
 *
 * SameSite=Strict: this cookie only needs to travel on same-origin XHR/
 * fetch calls the SPA makes itself (refresh, logout), never on a top-level
 * cross-site navigation, so there's no legitimate case Strict would break.
 */
export function buildRefreshTokenCookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function buildRefreshTokenClearCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
  };
}

/**
 * Sets the refresh-token cookie on `response`. Moved here (12.2) from
 * `AuthController`'s own private method so `account-access.controller.ts`'s
 * `POST /auth/activate` can set the exact same cookie without duplicating
 * this logic or reaching into `AuthController`.
 */
export function setRefreshCookie(
  response: Response,
  issued: { cookieValue: string; expiresAt: Date },
  ttlMs?: number,
): void {
  const maxAgeMs = ttlMs ?? issued.expiresAt.getTime() - Date.now();
  // CodeQL's `SensitiveCall` heuristic (SensitiveActions.qll) marks the
  // return value of any call whose NAME matches a password-like regex, with
  // no dataflow involved — so a caller reached from `changePassword()`/
  // `activate()` is treated as returning sensitive data purely because of
  // what it is called, and every field reached from it, including this one,
  // inherits that. `login()` and `refresh()` reach this same line with the
  // same shape and are not flagged, which is the tell.
  //
  // What is actually written here is a freshly issued refresh token
  // (`id.secret`, see RefreshTokenService.buildCookieValue) — never password
  // material, hashed or plain — under httpOnly + secure + sameSite=strict.
  response.cookie(
    REFRESH_TOKEN_COOKIE,
    issued.cookieValue, // codeql[js/clear-text-storage-of-sensitive-data]
    buildRefreshTokenCookieOptions(maxAgeMs),
  );
}
