/**
 * In-memory auth/tenant state the axios client reads on every request.
 *
 * Deliberately a plain module-scoped holder, not a store (Zustand/Context) —
 * this package has no state-management primitive wired up yet, and the
 * client only needs three values plus one callback. A future ticket can
 * back these setters with a real store without changing this module's
 * public surface.
 */
import { clearAllFormDrafts } from './form-draft-storage';
import { clearFreshness } from './freshness';
import { deleteOfflineDb, purgeTenantRefCache } from './offline-db';
import { clearApiCache } from './sw-cache';
import { clearPersistedTenant } from './tenant-storage';

let accessToken: string | null = null;
let activeTenantId: string | null = null;
let activeRole: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;

/** Every setter below calls this after changing state — `ui/src/hooks/
 * auth-state.ts`'s `useAccessToken`/`useActiveTenant`/`useActiveRole` are
 * `useSyncExternalStore` subscribers built on it, so a tenant switch, token
 * refresh, or logout re-renders every component reading one of those hooks,
 * not just the one that happened to trigger the change. This module stays a
 * plain state holder either way (see the header comment above) — this is
 * just a subscription list, not a store. */
const listeners = new Set<() => void>();

function notifyAuthStateChange(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeAuthState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Bumped by every `clearAuthState()` — logout and a failed reactive
 * refresh alike. `client.ts`'s `postAuthRefresh` captures this before its
 * network call and only calls `setAccessToken` if it's still current, so a
 * refresh that resolves after the session was reset can't resurrect a
 * token the reset just cleared. */
let sessionGeneration = 0;

export function currentSessionGeneration(): number {
  return sessionGeneration;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  notifyAuthStateChange();
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setActiveTenant(tenantId: string | null): void {
  // [8.12.1]: a mid-session tenant switch invalidates every API response
  // the service worker cached for the tenant we're leaving. Guarded on an
  // actual change *away from a real tenant* so the common cases — the
  // cold-boot restore setting the first tenant, or a re-set to the same
  // id — don't throw away a cache that is still correct. See
  // `sw-cache.ts` for why this is belt-and-braces with the cache key.
  if (activeTenantId !== null && activeTenantId !== tenantId) {
    clearApiCache();
    // [8.12.3]: the Dexie read cache and the freshness map are the second
    // and third things holding the leaving tenant's data, and they purge
    // through this exact funnel for the same reason `clearApiCache()`
    // does — one place a switch can be missed is one place another
    // school's students show up under this school's name.
    //
    // Fire-and-forget: this setter is synchronous and must stay so. A
    // failed purge is survivable because every Dexie row's key begins
    // with its own tenant id and every read filters on the *active*
    // tenant, so the leftovers are unreadable rather than dangerous —
    // the same "two mechanisms" argument `sw-cache.ts` documents.
    void purgeTenantRefCache(activeTenantId);
    clearFreshness();
    // [8.12.4]: the mutation queue is deliberately *not* purged here.
    // The asymmetry is the point — a cached read is reproducible, so
    // throwing it away costs a refetch; a queued mutation is the user's
    // unsaved work, so throwing it away costs the work. Isolation on a
    // switch is structural instead: `mutation-queue.ts` filters every
    // replay and every snapshot on the active tenant, so school A's
    // rows can never be sent or counted under school B, and they resume
    // when the user switches back. Logout is the destructive case, and
    // `clearAuthState()` below already covers it by deleting the whole
    // database.
  }
  activeTenantId = tenantId;
  notifyAuthStateChange();
}

export function getActiveTenant(): string | null {
  return activeTenantId;
}

export function setActiveRole(role: string | null): void {
  activeRole = role;
  notifyAuthStateChange();
}

export function getActiveRole(): string | null {
  return activeRole;
}

/** The consuming app registers a handler (typically a router navigation to
 * `/login`) — this package stays router-agnostic and never imports one. */
export function registerSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

export function clearAuthState(): void {
  accessToken = null;
  activeTenantId = null;
  activeRole = null;
  sessionGeneration += 1;
  // A different account can log into the same browser afterward — without
  // this, [8.9.5]'s cold-boot restore could silently pick a tenant the new
  // user happens to also belong to, one they never actually chose.
  clearPersistedTenant();
  // [8.12.1]: unconditional, unlike the switch above — logout and session
  // expiry both land here, and the next person at this browser must not
  // be able to read the previous session's data out of the offline cache.
  clearApiCache();
  // [8.12.3]: same unconditional reasoning as `clearApiCache()` above —
  // the whole offline database goes, not just one tenant's rows, and the
  // autosaved form drafts with it. A half-typed student record is
  // somebody's personal data too, and until now it outlived the session
  // that created it.
  void deleteOfflineDb();
  clearFreshness();
  clearAllFormDrafts();
  notifyAuthStateChange();
}

/** Called exactly once per failed refresh, regardless of how many concurrent
 * requests were waiting on it — see client.ts's single-flight refresh. */
export function notifySessionExpired(): void {
  clearAuthState();
  sessionExpiredHandler?.();
}
