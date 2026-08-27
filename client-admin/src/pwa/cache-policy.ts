/**
 * [8.12.1]'s API caching decisions, extracted out of `src/sw.ts` so they
 * can be unit-tested in a plain jsdom test rather than inside a
 * `ServiceWorkerGlobalScope` (which Vitest has no environment for).
 *
 * `sw.ts` holds the Workbox wiring; every *policy* question — is this
 * request cacheable at all, and under what key — is answered here.
 *
 * ## Why the cache key is not the URL
 *
 * Tenant identity travels as a request *header*, not in the path:
 * `ui/src/api/client.ts` sets `X-Tenant-ID` on every request while
 * `API_BASE_URL` stays a flat `/api/v1`. So a guardian who belongs to two
 * schools issues byte-identical `GET /api/v1/students` requests for both.
 * A stock URL-keyed runtime cache would happily serve school A's student
 * list to school B — a tenant-isolation break that no server-side guard
 * can catch, because the request never reaches the server.
 *
 * `apiCacheKeyFor` therefore folds the tenant id into the key. That is
 * defence in depth on top of `clearApiCache()` (`@biddaloy/ui/api`), which
 * wipes this cache outright on every tenant switch and logout: even if
 * that purge were ever skipped, a cross-tenant *hit* is impossible because
 * the keys differ.
 */

/** Name of the runtime cache holding API GET responses. Shared with
 * `ui/src/api/sw-cache.ts`, which deletes this exact cache on a tenant
 * switch or logout — the two constants must stay equal, and the test in
 * `cache-policy.test.ts` pins the literal so a rename here fails loudly
 * rather than silently orphaning a cache full of another tenant's data. */
export const API_CACHE_NAME = 'api-cache';

/** Name of the runtime cache holding lazily-fetched, content-hashed route
 * chunks. Separate from the API cache so a tenant switch — which must wipe
 * data — does not also throw away code that is identical for every tenant. */
export const ASSET_CACHE_NAME = 'asset-cache';

/** Mirrors `API_BASE_URL` in `ui/src/api/client.ts`. */
const API_PATH_PREFIX = '/api/v1/';

/** Login, refresh and logout. Never cached at any freshness: these carry
 * short-lived tokens and set/clear session cookies, and replaying a cached
 * one — even a stale-but-fresh-enough one — would hand back credentials
 * that the server has already rotated or revoked. */
const AUTH_PATH_PREFIX = '/api/v1/auth/';

export const TENANT_HEADER = 'X-Tenant-ID';

/** Stands in for a `Request` so tests don't need one — jsdom's `Request`
 * support is not something this policy should depend on. */
export interface TenantScopedRequest {
  url: string;
  headers: { get(name: string): string | null };
}

export interface ApiRouteMatch {
  url: URL;
  request: { method: string };
  sameOrigin?: boolean;
}

/**
 * True only for same-origin, non-auth `GET /api/v1/*`.
 *
 * Non-GET is excluded structurally, not by configuration: nothing this
 * service worker can do to a POST/PATCH/DELETE is safe. Replaying one is a
 * duplicate payment; caching its response is a lie about whether it
 * happened. Offline *mutations* are [8.12.3]'s queue, and deliberately not
 * a Workbox route.
 */
export function isCacheableApiRequest({ url, request, sameOrigin = true }: ApiRouteMatch): boolean {
  if (!sameOrigin) return false;
  if (request.method !== 'GET') return false;
  if (!url.pathname.startsWith(API_PATH_PREFIX)) return false;
  return !url.pathname.startsWith(AUTH_PATH_PREFIX);
}

/** Vite emits every built chunk into `/assets/` with a content hash in
 * the filename (`index-Bv-carHk.js`). The hash is what makes caching these
 * forever safe: a changed file is a different URL, so a cached entry can
 * never be stale — it can only become garbage, which expiry collects. */
const ASSET_PATH_PREFIX = '/assets/';
const HASHED_ASSET_PATTERN = /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/;

/**
 * True for a same-origin GET of a content-hashed JS/CSS chunk.
 *
 * These are precisely the route chunks [8.9.1] split out of the entry.
 * They are *not* precached (see `vite.config.ts` for why eagerly
 * downloading all of them defeats the point of splitting them); instead
 * each one is cached the first time the user actually navigates to that
 * route, so a second visit works offline without a first visit costing
 * 1.4 MB.
 *
 * Unhashed files are excluded: without a hash in the name, the URL is not
 * a promise about the contents, and cache-first would pin a stale copy.
 */
export function isHashedAssetRequest({ url, request, sameOrigin = true }: ApiRouteMatch): boolean {
  if (!sameOrigin) return false;
  if (request.method !== 'GET') return false;
  if (!url.pathname.startsWith(ASSET_PATH_PREFIX)) return false;
  return HASHED_ASSET_PATTERN.test(url.pathname);
}

/**
 * The cache key for an API GET: its URL with the active tenant folded in.
 *
 * Returned as a string (Workbox's `cacheKeyWillBeUsed` accepts one) using
 * a synthetic `__tenant` search param — a query param rather than a
 * fabricated path so the key stays a valid, inspectable URL in devtools'
 * Cache Storage panel.
 *
 * A request with no `X-Tenant-ID` (there are a few tenant-agnostic reads,
 * e.g. the memberships list used before a tenant is chosen) keys under an
 * explicit `none` rather than being left unsuffixed, so a tenant-less
 * response can never collide with a tenant-scoped one at the same URL.
 */
export function apiCacheKeyFor(request: TenantScopedRequest): string {
  const url = new URL(request.url);
  url.searchParams.set('__tenant', request.headers.get(TENANT_HEADER) ?? 'none');
  return url.toString();
}
