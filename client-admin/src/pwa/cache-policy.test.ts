import { describe, expect, it } from 'vitest';

import {
  API_CACHE_NAME,
  SW_CACHED_AT_HEADER,
  apiCacheKeyFor,
  ASSET_CACHE_NAME,
  isCacheableApiRequest,
  isHashedAssetRequest,
  TENANT_HEADER,
} from './cache-policy';

const ORIGIN = 'https://app.biddaloy.test';

function match(path: string, method = 'GET', sameOrigin = true) {
  return { url: new URL(path, ORIGIN), request: { method }, sameOrigin };
}

/** Minimal stand-in for a `Request` — see `TenantScopedRequest`. */
function req(path: string, tenantId: string | null) {
  return {
    url: new URL(path, ORIGIN).toString(),
    headers: { get: (name: string) => (name === TENANT_HEADER ? tenantId : null) },
  };
}

describe('isCacheableApiRequest', () => {
  it('caches an API GET', () => {
    expect(isCacheableApiRequest(match('/api/v1/students'))).toBe(true);
    expect(isCacheableApiRequest(match('/api/v1/fees/invoices?page=2'))).toBe(true);
  });

  it('never caches auth endpoints, which carry rotating credentials', () => {
    expect(isCacheableApiRequest(match('/api/v1/auth/refresh'))).toBe(false);
    expect(isCacheableApiRequest(match('/api/v1/auth/me'))).toBe(false);
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'never matches %s — a mutation must not be cached or replayed',
    (method) => {
      expect(isCacheableApiRequest(match('/api/v1/payments', method))).toBe(false);
    },
  );

  it('ignores non-API paths, which the precache and navigation route own', () => {
    expect(isCacheableApiRequest(match('/students'))).toBe(false);
    expect(isCacheableApiRequest(match('/assets/index-abc123.js'))).toBe(false);
    // `/api/v1` must be matched as a path *segment*: a route that merely
    // starts with the same characters is not the API.
    expect(isCacheableApiRequest(match('/api/v1beta/students'))).toBe(false);
  });

  it('ignores cross-origin requests', () => {
    expect(isCacheableApiRequest(match('/api/v1/students', 'GET', false))).toBe(false);
  });
});

describe('apiCacheKeyFor', () => {
  it('folds the tenant header into the key', () => {
    const key = apiCacheKeyFor(req('/api/v1/students', 'school-a'));
    expect(key).toContain('__tenant=school-a');
    expect(key).toContain('/api/v1/students');
  });

  it('gives two tenants distinct keys for a byte-identical URL', () => {
    // The whole point: `ui/src/api/client.ts` puts tenant identity in a
    // header, so without this both schools would share one cache entry
    // and school B could be served school A's student list.
    expect(apiCacheKeyFor(req('/api/v1/students', 'school-a'))).not.toBe(
      apiCacheKeyFor(req('/api/v1/students', 'school-b')),
    );
  });

  it('is stable for the same tenant and URL, so the cache actually hits', () => {
    expect(apiCacheKeyFor(req('/api/v1/students?page=1', 'school-a'))).toBe(
      apiCacheKeyFor(req('/api/v1/students?page=1', 'school-a')),
    );
  });

  it('preserves existing query params alongside the tenant marker', () => {
    const key = apiCacheKeyFor(req('/api/v1/students?page=2&q=ali', 'school-a'));
    expect(key).toContain('page=2');
    expect(key).toContain('q=ali');
    expect(key).toContain('__tenant=school-a');
  });

  it('keys a tenant-less request explicitly, never sharing with a tenant-scoped one', () => {
    const anonymous = apiCacheKeyFor(req('/api/v1/users/me/memberships', null));
    expect(anonymous).toContain('__tenant=none');
    expect(anonymous).not.toBe(apiCacheKeyFor(req('/api/v1/users/me/memberships', 'school-a')));
  });
});

describe('isHashedAssetRequest', () => {
  const asset = (pathname: string, method = 'GET', sameOrigin = true) => ({
    url: new URL(`https://school.biddaloy.test${pathname}`),
    request: { method },
    sameOrigin,
  });

  it('matches a content-hashed route chunk', () => {
    expect(isHashedAssetRequest(asset('/assets/students-Bv7carHk.js'))).toBe(true);
    expect(isHashedAssetRequest(asset('/assets/index-DkQ1p2Za.css'))).toBe(true);
  });

  it('rejects an unhashed asset, whose URL promises nothing about its contents', () => {
    // Cache-first on a stable URL pins a stale copy forever. Only the
    // hash makes "cache this immutably" a true statement.
    expect(isHashedAssetRequest(asset('/assets/runtime.js'))).toBe(false);
  });

  it('rejects anything outside /assets/, including the precached shell', () => {
    expect(isHashedAssetRequest(asset('/index.html'))).toBe(false);
    expect(isHashedAssetRequest(asset('/api/v1/students'))).toBe(false);
  });

  it('rejects cross-origin and non-GET', () => {
    expect(isHashedAssetRequest(asset('/assets/students-Bv7carHk.js', 'GET', false))).toBe(false);
    expect(isHashedAssetRequest(asset('/assets/students-Bv7carHk.js', 'POST'))).toBe(false);
  });
});

describe('ASSET_CACHE_NAME', () => {
  it('is a different cache from the API responses', () => {
    // A tenant switch wipes API data; it must not also throw away code,
    // which is identical for every tenant and expensive to re-download.
    expect(ASSET_CACHE_NAME).not.toBe(API_CACHE_NAME);
  });
});

describe('API_CACHE_NAME', () => {
  it('matches the literal `clearApiCache()` deletes in `ui/src/api/sw-cache.ts`', () => {
    // The two constants are intentionally duplicated (`ui` must not
    // depend on an app's build), so each side pins the literal. Renaming
    // one without the other would leave a cache of a departed tenant's
    // data that nothing ever purges.
    expect(API_CACHE_NAME).toBe('api-cache');
  });
});

describe('SW_CACHED_AT_HEADER', () => {
  it('matches the literal `offlineCachedQueryFn` reads in `ui/src/api/offline-cache.ts`', () => {
    // Duplicated on purpose (`ui` must not depend on one app's build), so
    // each side pins the literal. If these drift, every service-worker
    // replay silently reports itself as a live network response and the
    // "showing saved data" notice never appears — the one thing that makes
    // serving cached data acceptable at all.
    expect(SW_CACHED_AT_HEADER).toBe('x-sw-cached-at');
  });
});
