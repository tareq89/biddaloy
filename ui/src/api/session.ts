/**
 * [8.9.3]'s session lifecycle — cold-boot restore and proactive
 * pre-expiry refresh, both layered on top of `client.ts`'s `postAuthRefresh`
 * with their own single-flight lock and their own (quiet) failure handling.
 * See `ui/README.md`'s "Auth" section for the full write-up of why this is
 * a separate module from `auth-state.ts` (a plain state holder) and
 * `client.ts` (the interceptor's own reactive refresh).
 */
import type { JwtMembership, LoginResponse } from '@biddaloy/shared';

import {
  currentSessionGeneration,
  getAccessToken,
  setActiveRole,
  setActiveTenant,
} from './auth-state';
import { postAuthRefresh } from './client';
import { getPersistedTenant } from './tenant-storage';

/** Refresh this long before the token's own `exp` — comfortably ahead of
 * normal request/response latency, so a proactive refresh essentially
 * never loses the race against the token actually expiring mid-request. */
const REFRESH_MARGIN_MS = 60_000;

let refreshPromise: Promise<LoginResponse> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let bootstrapPromise: Promise<boolean> | null = null;

/** `atob()` maps each decoded byte to one UTF-16 code unit (Latin-1), not
 * UTF-8 — decoding a multi-byte character (a Bengali `JwtMembership.name`,
 * for one) straight through `atob()` alone corrupts it. Re-decodes those
 * same bytes as UTF-8 via `TextDecoder` instead. */
function decodeBase64UrlToString(base64url: string): string {
  const binary = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Decodes a JWT's payload without verifying its signature — this is a
 * client-side scheduling/display hint, never a trust decision (the server
 * is the only party that ever validates a token). Returns `null` for
 * anything that doesn't decode as `header.payload.signature` valid JSON. */
function decodeJwt(token: string): { exp?: unknown; sub?: unknown; memberships?: unknown } | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = decodeBase64UrlToString(payload);
    return JSON.parse(json) as { exp?: unknown; sub?: unknown; memberships?: unknown };
  } catch {
    return null;
  }
}

/** A malformed or non-JWT token just doesn't get a proactive timer — the
 * interceptor's existing reactive-401 refresh still covers it either way. */
function decodeJwtExpiryMs(token: string): number | null {
  const { exp } = decodeJwt(token) ?? {};
  return typeof exp === 'number' ? exp * 1000 : null;
}

/** [8.9.5]'s picker/top-bar/reload-restore all read memberships (with
 * school names) straight off the current access token rather than a
 * separate fetch — see `shared`'s `JwtMembership.name` for why. Returns
 * `[]` for a malformed token or a payload with no `memberships` array. */
/** [8.11.8]'s self-removal guard reads the logged-in user's own id off
 * the access token's `sub` claim (`JwtPayload.sub` = `user.id`, set by
 * `auth.service.ts`) — a display/UX hint, never a trust decision, same
 * caveat as every decode in this module. `null` for a malformed token. */
export function decodeAccessTokenSubject(token: string): string | null {
  const { sub } = decodeJwt(token) ?? {};
  return typeof sub === 'string' ? sub : null;
}

export function decodeAccessTokenMemberships(token: string): JwtMembership[] {
  const { memberships } = decodeJwt(token) ?? {};
  return Array.isArray(memberships) ? (memberships as JwtMembership[]) : [];
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
function quietRefresh(): Promise<LoginResponse> {
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
      .then((result) => scheduleTokenRefresh(result.access_token))
      .catch(() => {
        // Swallow: a failed proactive refresh means the refresh token
        // itself is dead. The next real API call's reactive-401 path
        // (client.ts) will hit that same failure and call
        // notifySessionExpired() then — retrying here too would just be a
        // slower, parallel copy of that already-tested mechanism.
      });
  }, delay);
}

/** [8.9.5]'s "choice survives reload": restores the active tenant from
 * `getPersistedTenant()` when it's still among the caller's *current*
 * memberships (a tenant removed since the last visit is silently dropped,
 * never restored — same "current, not stale" reasoning as `refresh()`'s
 * own server-side doc comment). [8.9.11] widens that from a tenant to the
 * `{tenantId, role}` pair, so a user who holds two roles at one school
 * comes back as the role they actually chose: a persisted role that is no
 * longer in the fresh memberships (revoked since the last visit) is
 * dropped by the same rule a removed tenant already was. A pre-[8.9.11]
 * value carries no role (`role: null`) and matches on tenant alone, which
 * is exactly what it used to do.
 *
 * Falls back to auto-picking a lone membership, mirroring `login()`'s
 * single-membership behavior. Leaves the active tenant unset for 0 or 2+
 * unresolved memberships — the root route's own guard decides what to do
 * with that (redirect to `/select-school`, or treat zero as unusable and
 * log out). No `queryClient.clear()` here: a cold page load has no cache
 * yet to clear. */
function restoreActiveTenant(accessToken: string): void {
  const memberships = decodeAccessTokenMemberships(accessToken);
  const persisted = getPersistedTenant();
  const match = persisted
    ? memberships.find(
        (m) =>
          m.tenantId === persisted.tenantId &&
          (persisted.role === null || m.role === persisted.role),
      )
    : undefined;
  const [only] = memberships;
  if (match) {
    setActiveTenant(match.tenantId);
    setActiveRole(match.role);
  } else if (memberships.length === 1 && only) {
    setActiveTenant(only.tenantId);
    setActiveRole(only.role);
  }
}

async function bootstrap(): Promise<boolean> {
  const generation = currentSessionGeneration();
  try {
    const result = await quietRefresh();
    // `postAuthRefresh()` already guards its own `setAccessToken` call the
    // same way (see that function's own comment) — but it still *returns*
    // `result.access_token` either way, so without this check a
    // `clearAuthState()` that ran while this call was in flight (a
    // concurrent logout, or a failed sibling refresh) would leave
    // `getAccessToken()` correctly `null` while this function still
    // restored tenant state, armed a refresh timer, and told the caller
    // (the root route guard) the session was authenticated.
    if (currentSessionGeneration() !== generation) return false;
    scheduleTokenRefresh(result.access_token);
    restoreActiveTenant(result.access_token);
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
