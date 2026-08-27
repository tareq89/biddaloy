/**
 * [8.12.1]'s tenant-safety valve for the service worker's API cache.
 *
 * The service worker (`client-admin/src/sw.ts`) caches `GET /api/v1/*`
 * responses network-first, so a user who goes offline still sees the last
 * data they loaded. That cache holds one tenant's student names, fee
 * balances and guardian phone numbers, and the *same browser profile* can
 * switch to another tenant (a head teacher with two schools) or be handed
 * to a different person entirely at logout.
 *
 * So: whenever the identity behind the cache changes, the cache goes.
 * `auth-state.ts` calls this from `setActiveTenant` and `clearAuthState`,
 * the two functions every switch/logout/session-expiry path already
 * funnels through.
 *
 * Two mechanisms fire, because a single silent failure here leaks another
 * school's data: a direct `caches.delete()` from the page, and a
 * `CLEAR_API_CACHE` message to the service worker (which does the same
 * delete from its own context, and is the only path that works where the
 * page cannot reach `caches` at all).
 *
 * This is the *primary* purge. The per-tenant cache key in
 * `client-admin/src/pwa/cache-policy.ts` is the second layer: even if this
 * never ran, a cross-tenant cache hit is impossible because the keys
 * differ. Two mechanisms because one silent failure here leaks another
 * school's data.
 */

/** Must equal `API_CACHE_NAME` in `client-admin/src/pwa/cache-policy.ts`.
 * Duplicated rather than imported because `ui` is consumed by every SPA
 * and must not depend on any one app's build. `sw-cache.test.ts` pins the
 * literal on this side; `cache-policy.test.ts` pins it on the other. */
const API_CACHE_NAME = 'api-cache';

/**
 * Deletes the service worker's API response cache. Fire-and-forget: the
 * callers are synchronous state setters that must not become async, and
 * there is no useful recovery from a failed delete beyond the key-scoping
 * fallback described above.
 *
 * Silently no-ops where `caches` is absent — jsdom under Vitest, any
 * non-secure context, a browser with storage disabled. Those are all
 * environments with no service worker either, so there is nothing to
 * purge.
 */
export function clearApiCache(): void {
  // Asks the service worker to purge from its own context. Sent first and
  // independently of the branch below: this is the path that still works
  // when the page itself has no `caches` access, and the worker's delete
  // of an already-deleted cache is a harmless no-op.
  if (typeof navigator !== 'undefined') {
    navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_API_CACHE' });
  }

  if (typeof caches === 'undefined') {
    return;
  }
  void caches.delete(API_CACHE_NAME).catch(() => {
    // A rejected delete leaves entries keyed to the *previous* tenant in
    // place. They can never be read back under the new tenant (different
    // cache key), and the entries expire within 24h, so swallowing this
    // is safe — and throwing would break a tenant switch over a cache.
  });
}
