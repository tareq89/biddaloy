/**
 * [8.12.3]. The two properties worth the most here are the ones a review
 * cannot eyeball:
 *
 * - a read under tenant B can never return a row written under tenant A,
 *   *even with the purge disabled* — that is what "structurally scoped"
 *   has to mean;
 * - an HTTP error (401/403/404) is never answered from cache, because
 *   doing so renders data the server just refused.
 *
 * IndexedDB itself comes from `fake-indexeddb`, installed globally in
 * `ui/src/test/setup.ts` (see that file on why it cannot be imported
 * here instead). It is a real implementation, not a stub, so the
 * index/keyRange behaviour the eviction and purge queries depend on is
 * genuinely exercised.
 */
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAuthState, setActiveTenant } from './auth-state';
import { ApiError } from './errors';
import { getFreshness } from './freshness';
import {
  MAX_ROWS_PER_ENTITY,
  offlineCachedQueryFn,
  readRefCache,
  REF_CACHE_TTL_MS,
  writeRefCache,
} from './offline-cache';
import { deleteOfflineDb, getOfflineDb, purgeTenantRefCache } from './offline-db';

const KEY = ['students', 'list', { page: 1 }];

function okResponse<T>(data: T, date?: string): AxiosResponse<T> {
  const headers = new AxiosHeaders();
  if (date) headers.set('date', date);
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers,
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse<T>;
}

/** The shape axios produces when the request never reached a server —
 * `response` is `undefined`. Deliberately built as a real `AxiosError`
 * rather than a plain `Error`: `axios.isAxiosError` checks a brand, so a
 * hand-rolled `{ isAxiosError: true }` fixture would prove nothing about
 * the code path a browser actually takes. */
function networkError(): AxiosError {
  return new AxiosError('Network Error', AxiosError.ERR_NETWORK, {
    headers: new AxiosHeaders(),
  });
}

/** A response replayed by the service worker: carries the `x-sw-cached-at`
 * stamp the worker writes at cache time. */
function swCachedResponse<T>(data: T, cachedAt: number): AxiosResponse<T> {
  const res = okResponse(data);
  (res.headers as AxiosHeaders).set('x-sw-cached-at', String(cachedAt));
  return res;
}

function httpError(status: number): AxiosError {
  const error = new AxiosError('Forbidden', AxiosError.ERR_BAD_REQUEST, {
    headers: new AxiosHeaders(),
  });
  error.response = { status } as AxiosResponse;
  return error;
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

beforeEach(async () => {
  // Belt to the teardown's braces: guarantees a clean store even if a
  // previous test bailed before its own `afterEach` completed.
  await deleteOfflineDb();
  setActiveTenant('tenant-a');
});

afterEach(async () => {
  vi.restoreAllMocks();
  // `offlineCachedQueryFn` writes to the cache fire-and-forget, so a test
  // can end with a `put` still in flight. Draining the macrotask queue
  // first stops that write from re-opening the database mid-delete and
  // landing in the *next* test's store.
  await new Promise((resolve) => setTimeout(resolve, 0));
  clearAuthState();
  // Awaited here rather than left to `clearAuthState()`'s fire-and-forget
  // delete. IndexedDB serialises `deleteDatabase` requests it has already
  // received — but an un-awaited one may not have been *issued* by the
  // time the next test issues its own, so the previous test's delete
  // could land mid-test and wipe rows that test had just written. That
  // produced a ~1-in-5 failure of "serves the cached body on a network
  // error", visible only under a full parallel run. Awaiting here means
  // no delete is ever in flight when a test begins.
  await deleteOfflineDb();
});

describe('writeRefCache / readRefCache', () => {
  it('round-trips a response body for the tenant that wrote it', async () => {
    await writeRefCache({
      entity: 'students',
      queryKey: KEY,
      data: { data: [{ id: 's1' }] },
      fetchedAt: 1_000,
    });

    await expect(readRefCache({ entity: 'students', queryKey: KEY, now: 2_000 })).resolves.toEqual({
      data: { data: [{ id: 's1' }] },
      fetchedAt: 1_000,
    });
  });

  it('never serves tenant A rows to tenant B even when the purge fails outright', async () => {
    await writeRefCache({
      entity: 'students',
      queryKey: KEY,
      data: { data: [{ id: 'school-a-student' }] },
      fetchedAt: Date.now(),
    });
    const db = getOfflineDb()!;
    await expect(db.refCache.count()).resolves.toBe(1);

    // The second, independent mechanism deliberately sabotaged: the
    // tenant-switch purge throws, so tenant A's rows survive the switch.
    // If key scoping were merely an optimisation, the read below would
    // now put one school's children on another school's roster.
    const where = vi.spyOn(db.refCache, 'where').mockImplementationOnce(() => {
      throw new Error('purge failed');
    });
    setActiveTenant('tenant-b');
    await Promise.resolve();
    where.mockRestore();

    await expect(readRefCache({ entity: 'students', queryKey: KEY })).resolves.toBeUndefined();
    // The row really is still there — the read was blocked, not the write
    // undone. Otherwise this would pass for the wrong reason.
    await expect(db.refCache.count()).resolves.toBe(1);
  });

  it('treats a row older than the 24h cap as a miss, not as stale-but-usable', async () => {
    const fetchedAt = 1_000_000;
    await writeRefCache({ entity: 'students', queryKey: KEY, data: { a: 1 }, fetchedAt });

    await expect(
      readRefCache({ entity: 'students', queryKey: KEY, now: fetchedAt + REF_CACHE_TTL_MS + 1 }),
    ).resolves.toBeUndefined();
    await expect(
      readRefCache({ entity: 'students', queryKey: KEY, now: fetchedAt + REF_CACHE_TTL_MS }),
    ).resolves.toBeDefined();
  });

  it('writes nothing when no tenant is active — an unscoped row has no owner', async () => {
    clearAuthState();

    await writeRefCache({ entity: 'students', queryKey: KEY, data: { a: 1 }, fetchedAt: 1 });

    setActiveTenant('tenant-a');
    await expect(readRefCache({ entity: 'students', queryKey: KEY })).resolves.toBeUndefined();
  });

  it('keeps only the newest MAX_ROWS_PER_ENTITY rows per tenant+entity pair', async () => {
    for (let i = 0; i < MAX_ROWS_PER_ENTITY + 5; i += 1) {
      await writeRefCache({
        entity: 'students',
        queryKey: ['students', 'list', { page: i }],
        data: { page: i },
        fetchedAt: 1_000 + i,
      });
    }

    const db = getOfflineDb()!;
    const rows = await db.refCache.toArray();
    expect(rows).toHaveLength(MAX_ROWS_PER_ENTITY);
    // The five *oldest* went, not five arbitrary ones.
    expect(Math.min(...rows.map((r) => r.fetchedAt))).toBe(1_005);
  });

  it('evicts per entity, so a churning student list cannot evict the class list', async () => {
    await writeRefCache({
      entity: 'classes',
      queryKey: ['classes', 'list', {}],
      data: { keep: true },
      fetchedAt: 1,
    });
    for (let i = 0; i < MAX_ROWS_PER_ENTITY + 5; i += 1) {
      await writeRefCache({
        entity: 'students',
        queryKey: ['students', 'list', { page: i }],
        data: { page: i },
        fetchedAt: 1_000 + i,
      });
    }

    await expect(
      readRefCache({ entity: 'classes', queryKey: ['classes', 'list', {}], now: 2_000 }),
    ).resolves.toEqual({ data: { keep: true }, fetchedAt: 1 });
  });

  it('does not reject when the write fails — a dead cache must not fail a good response', async () => {
    const db = getOfflineDb()!;
    vi.spyOn(db.refCache, 'put').mockRejectedValue(new Error('disk on fire'));

    await expect(
      writeRefCache({ entity: 'students', queryKey: KEY, data: { a: 1 }, fetchedAt: 1 }),
    ).resolves.toBeUndefined();
  });

  it('drops the entity and retries once on QuotaExceededError', async () => {
    const db = getOfflineDb()!;
    // The real thing a browser throws is a `DOMException` whose `name` is
    // `QuotaExceededError` — reproduced by name here rather than as a
    // generic `Error('quota')`, since matching on the name is exactly
    // what the production code does.
    const quota = new DOMException('quota', 'QuotaExceededError');
    const put = vi.spyOn(db.refCache, 'put');
    put.mockRejectedValueOnce(quota);

    await writeRefCache({ entity: 'students', queryKey: KEY, data: { a: 1 }, fetchedAt: 5 });

    expect(put).toHaveBeenCalledTimes(2);
    await expect(readRefCache({ entity: 'students', queryKey: KEY, now: 10 })).resolves.toEqual({
      data: { a: 1 },
      fetchedAt: 5,
    });
  });

  it('gives up quietly when the retry after a quota purge also fails', async () => {
    const db = getOfflineDb()!;
    vi.spyOn(db.refCache, 'put').mockRejectedValue(new DOMException('quota', 'QuotaExceededError'));

    await expect(
      writeRefCache({ entity: 'students', queryKey: KEY, data: { a: 1 }, fetchedAt: 5 }),
    ).resolves.toBeUndefined();
  });

  it('returns undefined rather than throwing when the read itself fails', async () => {
    const db = getOfflineDb()!;
    vi.spyOn(db.refCache, 'get').mockRejectedValue(new Error('db closed'));

    await expect(readRefCache({ entity: 'students', queryKey: KEY })).resolves.toBeUndefined();
  });
});

describe('purgeTenantRefCache', () => {
  it('deletes only the named tenant’s rows', async () => {
    await writeRefCache({ entity: 'students', queryKey: KEY, data: { a: 1 }, fetchedAt: 1 });
    // Written straight to the table rather than by switching tenants,
    // because switching would fire the very purge under test.
    await getOfflineDb()!.refCache.put({
      id: 'tenant-b students x',
      tenantId: 'tenant-b',
      entity: 'students',
      queryHash: 'x',
      fetchedAt: 1,
      payload: { b: 2 },
    });

    await purgeTenantRefCache('tenant-a');

    const rows = await getOfflineDb()!.refCache.toArray();
    expect(rows.map((r) => r.tenantId)).toEqual(['tenant-b']);
  });

  it('swallows a failed purge — the key scoping is what keeps tenants apart', async () => {
    const db = getOfflineDb()!;
    vi.spyOn(db.refCache, 'where').mockImplementation(() => {
      throw new Error('db closed');
    });

    await expect(purgeTenantRefCache('tenant-a')).resolves.toBeUndefined();
  });
});

describe('offlineCachedQueryFn', () => {
  it('resolves res.data unchanged on success, so loaders and consumers see no difference', async () => {
    const queryFn = offlineCachedQueryFn({
      entity: 'students',
      queryKey: KEY,
      fetch: () => Promise.resolve(okResponse({ data: [{ id: 's1' }], total: 1 })),
    });

    await expect(queryFn({ signal: signal() })).resolves.toEqual({
      data: [{ id: 's1' }],
      total: 1,
    });
  });

  it('labels a response the server produced just now as network', async () => {
    const queryFn = offlineCachedQueryFn({
      entity: 'students',
      queryKey: KEY,
      fetch: () => Promise.resolve(okResponse({ ok: true }, new Date().toUTCString())),
    });

    await queryFn({ signal: signal() });

    expect(getFreshness(KEY)).toMatchObject({ source: 'network' });
  });

  it('labels a service-worker replay as sw-cache, from the stamp the worker wrote', async () => {
    // A `NetworkFirst` hit replays a response the server sent hours ago —
    // a 200 axios cannot otherwise tell apart from a live one. The worker
    // stamps `x-sw-cached-at` with `Date.now()` when it stores the
    // response (`client-admin/src/sw.ts`), so this is the browser's own
    // clock on both sides. The server's `Date` header is deliberately
    // *not* consulted: comparing it to `Date.now()` compares two clocks,
    // and a phone running minutes fast would then label every fresh
    // response stale.
    const cachedAt = Date.now() - 2 * 60 * 60 * 1000;
    const queryFn = offlineCachedQueryFn({
      entity: 'students',
      queryKey: KEY,
      fetch: () => Promise.resolve(swCachedResponse({ ok: true }, cachedAt)),
    });

    await queryFn({ signal: signal() });

    expect(getFreshness(KEY)).toEqual({ source: 'sw-cache', fetchedAt: cachedAt });
  });

  it('labels a live response as network even when the device clock is minutes fast', async () => {
    // The regression this guards: deriving staleness from the server's
    // `Date` header against `Date.now()` meant an unsynced clock — routine
    // on the low-end Android this epic targets — pinned "showing saved
    // data" onto every list for a fully-online user.
    const serverDate = new Date(Date.now() - 5 * 60 * 1000).toUTCString();
    const queryFn = offlineCachedQueryFn({
      entity: 'students',
      queryKey: KEY,
      fetch: () => Promise.resolve(okResponse({ ok: true }, serverDate)),
    });

    await queryFn({ signal: signal() });

    expect(getFreshness(KEY)?.source).toBe('network');
  });

  it('falls back to Date.now() when the response carries no Date header', async () => {
    const queryFn = offlineCachedQueryFn({
      entity: 'students',
      queryKey: KEY,
      fetch: () => Promise.resolve(okResponse({ ok: true })),
    });

    await queryFn({ signal: signal() });

    expect(getFreshness(KEY)?.source).toBe('network');
  });

  it('serves the cached body on a network error and labels it dexie', async () => {
    await writeRefCache({
      entity: 'students',
      queryKey: KEY,
      data: { data: [{ id: 'cached' }] },
      fetchedAt: Date.now() - 60_000,
    });

    const queryFn = offlineCachedQueryFn({
      entity: 'students',
      queryKey: KEY,
      fetch: () => Promise.reject(networkError()),
    });

    await expect(queryFn({ signal: signal() })).resolves.toEqual({ data: [{ id: 'cached' }] });
    expect(getFreshness(KEY)?.source).toBe('dexie');
  });

  it('rethrows the network error when there is nothing cached', async () => {
    const queryFn = offlineCachedQueryFn({
      entity: 'students',
      queryKey: KEY,
      fetch: () => Promise.reject(networkError()),
    });

    await expect(queryFn({ signal: signal() })).rejects.toThrow('Network Error');
  });

  it.each([401, 403, 404, 500])(
    'never answers an HTTP %i from cache — the server refused this request',
    async (status) => {
      await writeRefCache({
        entity: 'students',
        queryKey: KEY,
        data: { data: [{ id: 'must-not-be-shown' }] },
        fetchedAt: Date.now(),
      });

      const queryFn = offlineCachedQueryFn({
        entity: 'students',
        queryKey: KEY,
        fetch: () => Promise.reject(httpError(status)),
      });

      await expect(queryFn({ signal: signal() })).rejects.toBeDefined();
    },
  );

  it('never answers an ApiError from cache either', async () => {
    await writeRefCache({
      entity: 'students',
      queryKey: KEY,
      data: { data: [] },
      fetchedAt: Date.now(),
    });
    const apiError = new ApiError({
      statusCode: 403,
      message: 'Forbidden',
      timestamp: new Date().toISOString(),
      path: '/students',
      requestId: 'r1',
    });

    const queryFn = offlineCachedQueryFn({
      entity: 'students',
      queryKey: KEY,
      fetch: () => Promise.reject(apiError),
    });

    await expect(queryFn({ signal: signal() })).rejects.toBe(apiError);
  });

  it('rethrows a non-axios failure rather than treating it as "offline"', async () => {
    await writeRefCache({
      entity: 'students',
      queryKey: KEY,
      data: { data: [] },
      fetchedAt: Date.now(),
    });
    const bug = new TypeError('res.data.map is not a function');

    const queryFn = offlineCachedQueryFn({
      entity: 'students',
      queryKey: KEY,
      fetch: () => Promise.reject(bug),
    });

    // A programming error inside the fetch is not a network failure, and
    // quietly answering it from cache would hide the bug behind
    // plausible-looking stale data.
    await expect(queryFn({ signal: signal() })).rejects.toBe(bug);
  });

  it('rethrows a cancellation rather than resolving it with stale data', async () => {
    await writeRefCache({
      entity: 'students',
      queryKey: KEY,
      data: { data: [] },
      fetchedAt: Date.now(),
    });
    const cancel = new AxiosError('canceled', AxiosError.ERR_CANCELED);
    // What `axios.isCancel` actually brands a cancellation with — an
    // aborted request must stay aborted, or unmounting a screen quietly
    // repopulates a cache entry the app already moved on from.
    (cancel as unknown as { __CANCEL__: boolean }).__CANCEL__ = true;

    const queryFn = offlineCachedQueryFn({
      entity: 'students',
      queryKey: KEY,
      fetch: () => Promise.reject(cancel),
    });

    await expect(queryFn({ signal: signal() })).rejects.toBe(cancel);
  });
});
