import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAuthState, setActiveTenant } from './auth-state';
import { clearApiCache } from './sw-cache';

/** jsdom has no Cache Storage, so every test that expects a delete has to
 * install one. Returns the spy the assertions read. */
function installCaches(deleteImpl: () => Promise<boolean> = () => Promise.resolve(true)) {
  const del = vi.fn(deleteImpl);
  vi.stubGlobal('caches', { delete: del });
  return del;
}

/** A page with an active service worker controlling it. Returns the spy
 * standing in for the worker's inbox. */
function installController() {
  const postMessage = vi.fn();
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: { controller: { postMessage } },
  });
  return postMessage;
}

describe('clearApiCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('deletes the service worker cache the API responses live in', () => {
    const del = installCaches();

    clearApiCache();

    // Pinned literal: `client-admin/src/pwa/cache-policy.ts` names the
    // same cache and the two are duplicated on purpose (`ui` must not
    // depend on one app's build).
    expect(del).toHaveBeenCalledWith('api-cache');
  });

  it('also asks the service worker to purge, so a page that cannot reach Cache Storage still does', () => {
    const postMessage = installController();
    vi.stubGlobal('caches', undefined);

    clearApiCache();

    // This is the only purge path left when the page has no `caches`
    // access — a stricter CSP, a browser quirk. Without it, logging out
    // leaves the previous session's responses being served to whoever
    // uses the browser next.
    expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_API_CACHE' });
  });

  it('purges by both paths when both are available', () => {
    const postMessage = installController();
    const del = installCaches();

    clearApiCache();

    expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_API_CACHE' });
    expect(del).toHaveBeenCalledWith('api-cache');
  });

  it('no-ops where there is no controlling service worker', () => {
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { controller: null } });
    const del = installCaches();

    expect(() => clearApiCache()).not.toThrow();
    expect(del).toHaveBeenCalledWith('api-cache');
  });

  it('no-ops where Cache Storage does not exist', () => {
    // jsdom, an insecure context, storage disabled — all environments with
    // no service worker either, so there is nothing to purge. Must not
    // throw: the callers are synchronous auth-state setters.
    vi.stubGlobal('caches', undefined);

    expect(() => clearApiCache()).not.toThrow();
  });

  it('swallows a rejected delete rather than breaking the tenant switch', async () => {
    const del = installCaches(() => Promise.reject(new Error('QuotaExceeded')));

    expect(() => clearApiCache()).not.toThrow();
    await expect(del.mock.results[0]?.value).rejects.toThrow('QuotaExceeded');
  });
});

describe('auth-state purges the offline API cache', () => {
  let del: ReturnType<typeof installCaches>;

  beforeEach(() => {
    del = installCaches();
  });

  afterEach(() => {
    clearAuthState();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('purges when an active tenant is switched for another', () => {
    setActiveTenant('school-a');
    del.mockClear();

    setActiveTenant('school-b');

    expect(del).toHaveBeenCalledWith('api-cache');
  });

  it('does not purge when the first tenant is chosen', () => {
    // [8.9.5]'s cold-boot restore sets the tenant from persisted storage
    // on every load. Purging here would throw away the offline cache on
    // exactly the load that most needs it — an offline cold boot.
    setActiveTenant('school-a');

    expect(del).not.toHaveBeenCalled();
  });

  it('does not purge when the same tenant is re-set', () => {
    setActiveTenant('school-a');
    del.mockClear();

    setActiveTenant('school-a');

    expect(del).not.toHaveBeenCalled();
  });

  it('purges on logout, so the next person at this browser sees nothing', () => {
    setActiveTenant('school-a');
    del.mockClear();

    clearAuthState();

    expect(del).toHaveBeenCalledWith('api-cache');
  });

  it('purges on logout even when no tenant was ever active', () => {
    // A session that expired before a tenant was chosen still cached
    // tenant-less reads (the memberships list), keyed `__tenant=none`.
    clearAuthState();

    expect(del).toHaveBeenCalledWith('api-cache');
  });
});
