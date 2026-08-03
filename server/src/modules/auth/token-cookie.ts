import { CookieOptions } from "express";

export const REFRESH_TOKEN_COOKIE = "refresh_token";

// Scoped to just the auth routes that need it (refresh/logout/logout-all),
// not '/' — the browser never attaches this cookie to any other request,
// which is worth more than it costs since every one of those routes lives
// under this same prefix.
export const REFRESH_TOKEN_COOKIE_PATH = "/api/v1/auth";

/**
 * SameSite=Strict rather than Lax: this cookie only needs to travel on
 * same-origin XHR/fetch calls the SPA makes itself (refresh, logout), never
 * on a top-level cross-site navigation, so there's no legitimate case
 * Strict would break. secure is relaxed outside production the same way
 * helmet/trust-proxy already are (security-headers.ts, main.ts), so local
 * HTTP dev keeps working.
 *
 * No __Host- prefix: that requires Path=/, which conflicts with scoping the
 * cookie to REFRESH_TOKEN_COOKIE_PATH — the path restriction was judged the
 * better trade for this deployment. Revisit alongside #48 (CSRF posture) if
 * that changes.
 */
export function buildRefreshTokenCookieOptions(nodeEnv: string | undefined, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: nodeEnv === "production",
    sameSite: "strict",
    path: REFRESH_TOKEN_COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

export function buildRefreshTokenClearCookieOptions(nodeEnv: string | undefined): CookieOptions {
  return {
    httpOnly: true,
    secure: nodeEnv === "production",
    sameSite: "strict",
    path: REFRESH_TOKEN_COOKIE_PATH,
  };
}
