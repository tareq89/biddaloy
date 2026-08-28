/// <reference lib="webworker" />
/**
 * [8.12.1]'s service worker, hand-written and compiled by
 * `vite-plugin-pwa`'s `injectManifest` strategy.
 *
 * Why `injectManifest` and not the zero-code `generateSW`: `generateSW`
 * can only express URL-keyed runtime caches, and this app's tenant
 * identity lives in a request *header* (see `pwa/cache-policy.ts` for the
 * full argument). A custom `cacheKeyWillBeUsed` is not expressible in
 * `generateSW`'s config, and neither is the `CLEAR_API_CACHE` message
 * channel below or the `SKIP_WAITING` hook [8.12.2] needs.
 *
 * This file is bundled separately from the app — it runs in a
 * `ServiceWorkerGlobalScope`, with no DOM and no React. Keep it thin:
 * every decision it makes is imported from `pwa/cache-policy.ts`, which is
 * plain, testable module code.
 */
import { clientsClaim, type WorkboxPlugin } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';

import {
  API_CACHE_NAME,
  ASSET_CACHE_NAME,
  apiCacheKeyFor,
  isCacheableApiRequest,
  isHashedAssetRequest,
  SW_CACHED_AT_HEADER,
} from './pwa/cache-policy';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// The app shell: hashed JS/CSS chunks, `index.html`, fonts and icons. The
// list itself is injected at build time by `vite-plugin-pwa` from the real
// Rollup output, so it can never drift from what actually shipped.
precacheAndRoute(self.__WB_MANIFEST);

// Lazily-fetched route chunks: cache-first, because their filenames carry
// a content hash and therefore can never go stale — a changed file is a
// new URL. Precaching them instead would mean downloading every route on
// first visit (~1.4 MB) and again on every deploy; this way each route
// costs its own download once, and is offline-available afterwards.
registerRoute(
  isHashedAssetRequest,
  new CacheFirst({
    cacheName: ASSET_CACHE_NAME,
    plugins: [
      new ExpirationPlugin({
        // Generous: entries are immutable, so the only reason to evict is
        // to stop superseded builds accumulating forever.
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }) as WorkboxPlugin,
    ],
  }),
);

// SPA navigations: every in-app URL is served by the same precached
// `index.html`, so a cold offline load of `/students/42` still boots the
// router instead of showing the browser's dinosaur. `/api/**` is excluded
// so an API call never gets an HTML document back — a JSON parse error is
// a far worse failure mode than a network error the app already handles.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//],
  }),
);

// API reads: network-first, never stale-first. The cache is a *fallback*
// for a dead network, not a speed optimisation — showing a parent a
// last-week fee balance as if it were current is worse than showing them
// nothing. The 5s timeout bounds the "connected to a captive portal /
// one-bar mobile" case, where the request neither succeeds nor fails
// quickly; past it, the cached copy renders and [8.12.4]'s sync indicator
// will (later) say it is stale.
registerRoute(
  isCacheableApiRequest,
  new NetworkFirst({
    cacheName: API_CACHE_NAME,
    networkTimeoutSeconds: 5,
    plugins: [
      // Explicitly [200] only: Workbox's default also caches opaque (0)
      // responses, and an opaque response here would be an unreadable
      // stand-in for real data.
      // `Promise.resolve` rather than an `async` hook: both decisions are
      // synchronous, and Workbox only requires a thenable.
      {
        // Explicitly [200] only: Workbox's default also caches opaque (0)
        // responses, and an opaque response here would be an unreadable
        // stand-in for real data.
        //
        // The stored copy is stamped with `x-sw-cached-at`, read back by
        // `offlineCachedQueryFn` (`@biddaloy/ui/api`) to decide whether a
        // response came from the network or from this cache. The stamp is
        // the *browser's* clock, deliberately: the obvious alternative —
        // comparing the server's `Date` header against `Date.now()` —
        // compares two different clocks, so a phone running a couple of
        // minutes fast would label every fresh response as stale and
        // permanently show "showing saved data" to a fully-online user.
        // Unsynced clocks are routine on the low-end Android this epic
        // targets. Same clock in, same clock out, no skew budget needed.
        cacheWillUpdate: async ({ response }) => {
          if (response.status !== 200) return null;
          const headers = new Headers(response.headers);
          headers.set(SW_CACHED_AT_HEADER, String(Date.now()));
          return new Response(await response.blob(), {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        },
      },
      {
        // The tenant-scoped key — see `pwa/cache-policy.ts`. Applied to
        // both reads and writes because Workbox calls this hook for each.
        cacheKeyWillBeUsed: ({ request }) => Promise.resolve(apiCacheKeyFor(request)),
      },
      // Cast because `ExpirationPlugin` declares its optional hooks as
      // `cacheDidUpdate?: Callback` while `WorkboxPlugin` declares them
      // as `Callback | undefined` — incompatible only under this repo's
      // `exactOptionalPropertyTypes`, and purely a typings mismatch in
      // Workbox's own published `.d.ts` files.
      new ExpirationPlugin({
        maxEntries: 100,
        // A day. Longer and an offline fallback stops being "the last
        // thing you saw" and starts being archaeology.
        maxAgeSeconds: 24 * 60 * 60,
        purgeOnQuotaError: true,
      }) as WorkboxPlugin,
    ],
  }),
);

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const type = (event.data as { type?: string } | null)?.type;

  // Dormant until [8.12.2] builds the "a new version is available"
  // prompt. Registered with `registerType: 'prompt'` (see
  // `pwa/register.ts`), so nothing sends this message today — it exists
  // so the update flow is a UI change in that issue rather than a service
  // worker change, which would need a full activation cycle to ship.
  if (type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }

  // Sent by `clearApiCache()` (`ui/src/api/sw-cache.ts`) on a tenant
  // switch or logout, in addition to its own `caches.delete()`. Two paths
  // to the same purge because a missed one leaks another school's data:
  // this handler is the one that still works from a client with no
  // `caches` access (a stricter future CSP, a browser quirk), and it keeps
  // the cache's name something the worker can own.
  //
  // Only the API cache. The asset cache holds content-hashed code, which
  // is identical for every tenant and carries no data worth purging.
  if (type === 'CLEAR_API_CACHE') {
    event.waitUntil(caches.delete(API_CACHE_NAME));
  }
});

// A newly-activated worker takes over open tabs immediately. Safe here
// because the only runtime cache is keyed per tenant and the precache is
// content-hashed: there is no half-old/half-new state a claimed client
// could land in.
clientsClaim();
