/**
 * [8.9.3]'s session lifecycle — cold-boot restore and proactive
 * pre-expiry refresh, both layered on top of `client.ts`'s `postAuthRefresh`
 * with their own single-flight lock and their own (quiet) failure handling.
 * See `ui/README.md`'s "Auth" section for the full write-up of why this is
 * a separate module from `auth-state.ts` (a plain state holder) and
 * `client.ts` (the interceptor's own reactive refresh).
 */
import { getAccessToken } from './auth-state';
import { postAuthRefresh } from './client';

/** Refresh this long before the token's own `exp` — comfortably ahead of
 * normal request/response latency, so a proactive refresh essentially
 * never loses the race against the token actually expiring mid-request. */
const REFRESH_MARGIN_MS = 60_000;

let refreshPromise: Promise<string> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let bootstrapPromise: Promise<boolean> | null = null;

/** Reads a JWT's `exp` claim without verifying its signature — this is a
 * scheduling hint, never a trust decision (the server is the only party
 * that ever validates a token). Returns `null` for anything that doesn't
 * decode as `header.payload.signature` with a numeric `exp`, so a
 * malformed or non-JWT token just doesn't get a proactive timer — the
 * interceptor's existing reactive-401 refresh still covers it either way. */
function decodeJwtExpiryMs(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const { exp } = JSON.parse(json) as { exp?: unknown };
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function clearScheduledRefresh(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/** Cancels any pending proactive refresh and forgets the cold-boot
 * bootstrap ever ran — called from `ui/src/hooks/auth.ts`'s `logout`/
 * `logoutAll` (so a stale timer doesn't fire a refresh call after the
 * refresh cookie has just been server-side revoked) and from
 * `cleanupTestState()` (so the memoized bootstrap promise and any armed
 * timer don't leak from one test into the next — ES modules are cached
 * per worker, not reset per test). */
export function resetSessionBootstrap(): void {
  bootstrapPromise = null;
  clearScheduledRefresh();
}

/** `postAuthRefresh()` behind its own single-flight lock, with no
 * `notifySessionExpired()` on failure — unlike `client.ts`'s
 * `refreshAccessToken`, nothing here has "a session that just ended" to
 * announce: a cold-boot attempt from an anonymous visitor and a
 * proactive pre-expiry refresh are both routine, not error events. */
function quietRefresh(): Promise<string> {
  refreshPromise ??= postAuthRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/** Arms (or re-arms) the proactive pre-expiry timer for `token`. Exported
 * so [8.9.4]'s `login()` can call this directly after setting a fresh
 * token from a real login response, the same way bootstrap does below. */
export function scheduleTokenRefresh(token: string): void {
  clearScheduledRefresh();
  const expiryMs = decodeJwtExpiryMs(token);
  if (expiryMs === null) return;
  const delay = Math.max(0, expiryMs - Date.now() - REFRESH_MARGIN_MS);
  refreshTimer = setTimeout(() => {
    void quietRefresh()
      .then(scheduleTokenRefresh)
      .catch(() => {
        // Swallow: a failed proactive refresh means the refresh token
        // itself is dead. The next real API call's reactive-401 path
        // (client.ts) will hit that same failure and call
        // notifySessionExpired() then — retrying here too would just be a
        // slower, parallel copy of that already-tested mechanism.
      });
  }, delay);
}

async function bootstrap(): Promise<boolean> {
  try {
    const token = await quietRefresh();
    scheduleTokenRefresh(token);
    return true;
  } catch {
    return false;
  }
}

/** The one function a protected route's `beforeLoad` needs:
 * `client-admin/src/routes/__root.tsx` awaits this before deciding whether
 * to redirect to `/login`. Short-circuits to `true` with no network call
 * once a token is set (every navigation after the first one, or any time
 * after a real login) — the cold-boot POST /auth/refresh only ever
 * happens once per app lifetime, memoized in `bootstrapPromise`. */
export function ensureSessionLoaded(): Promise<boolean> {
  if (getAccessToken()) return Promise.resolve(true);
  bootstrapPromise ??= bootstrap();
  return bootstrapPromise;
}
