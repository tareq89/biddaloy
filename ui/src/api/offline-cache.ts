/**
 * [8.12.3] The read/write layer over `offline-db.ts`, plus
 * `offlineCachedQueryFn` — the one thing a query hook actually wires in.
 *
 * Read `offline-db.ts`'s header first: it owns the schema, the tenant
 * isolation argument, and why this store complements rather than replaces
 * the service worker's `api-cache`.
 */
import { hashKey, type QueryKey } from '@tanstack/react-query';
import axios, { type AxiosResponse } from 'axios';

import { getActiveTenant } from './auth-state';
import { ApiError } from './errors';
import { recordFreshness } from './freshness';
import { getOfflineDb, type CacheableEntity, type RefCacheRow } from './offline-db';

/**
 * Matches the service worker's 24h `ExpirationPlugin` maxAgeSeconds
 * (`client-admin/src/pwa/cache-policy.ts`) on purpose: two layers that
 * disagree about when data is dead would let the slower one resurrect
 * what the faster one just expired. A row older than this is treated as a
 * miss, not as stale-but-usable — a day-old class roster is a plausible
 * lie, and the epic's rule is that we would rather show an error than
 * something plausibly wrong.
 */
export const REF_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The documented storage cap, per `[tenantId+entity]` pair. Twenty rows
 * covers a working session's realistic filter/page permutations (a list
 * screen paged through with a couple of filter changes) while keeping the
 * whole database in the low single-digit megabytes. Beyond it, the oldest
 * rows for that pair are evicted — LRU by `fetchedAt`, which for this
 * store is the same thing as least-recently-*fetched*.
 */
export const MAX_ROWS_PER_ENTITY = 20;

function rowId(tenantId: string, entity: CacheableEntity, queryHash: string): string {
  return `${tenantId} ${entity} ${queryHash}`;
}

/**
 * Fire-and-forget write. Never rejects: a failed cache write must not turn
 * a successful API response into a failed query.
 *
 * No-ops with no active tenant — an unscoped row could not be read back
 * safely and would sit in storage under no owner.
 */
export async function writeRefCache(params: {
  entity: CacheableEntity;
  queryKey: QueryKey;
  data: unknown;
  fetchedAt: number;
}): Promise<void> {
  const { entity, queryKey, data, fetchedAt } = params;
  const db = await getOfflineDb();
  const tenantId = getActiveTenant();
  if (!db || !tenantId) return;

  const row: RefCacheRow = {
    id: rowId(tenantId, entity, hashKey(queryKey)),
    tenantId,
    entity,
    queryHash: hashKey(queryKey),
    fetchedAt,
    payload: data,
  };

  try {
    await db.refCache.put(row);
    await evictOverCap(tenantId, entity);
  } catch (error) {
    // A quota error means the browser has decided we are out of space.
    // Dropping this entity's rows and retrying once is Workbox's
    // `purgeOnQuotaError` behaviour, brought over deliberately: the
    // alternative — leaving the store permanently full and silently
    // never caching again — is the failure mode users never notice
    // until they are offline and have nothing.
    if (isQuotaExceeded(error)) {
      try {
        await db.refCache.where({ tenantId, entity }).delete();
        await db.refCache.put(row);
      } catch {
        // Still failing after a purge: give up quietly. Offline cache is
        // an enhancement on top of a working online app.
      }
    }
    // Any other write failure is swallowed for the same reason.
  }
}

/**
 * `QuotaExceededError` arrives as a `DOMException` in a real browser and,
 * depending on the polyfill, as a plain `Error` with the same `name`
 * under `fake-indexeddb`. Matching on `name` rather than `instanceof
 * DOMException` covers both — and `DOMException` does not exist at all in
 * some Node versions this package's `:node` tests run under, so an
 * `instanceof` check would throw while deciding whether something threw.
 */
function isQuotaExceeded(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'QuotaExceededError'
  );
}

/** Enforces `MAX_ROWS_PER_ENTITY` for one `[tenantId+entity]` pair by
 * dropping the oldest rows. Scoped to the pair rather than the whole
 * store so a heavily-filtered student list can never evict the only
 * cached copy of the class list. */
async function evictOverCap(tenantId: string, entity: CacheableEntity): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;
  const rows = await db.refCache.where({ tenantId, entity }).toArray();
  if (rows.length <= MAX_ROWS_PER_ENTITY) return;
  const doomed = rows
    .sort((a, b) => a.fetchedAt - b.fetchedAt)
    .slice(0, rows.length - MAX_ROWS_PER_ENTITY)
    .map((row) => row.id);
  await db.refCache.bulkDelete(doomed);
}

/**
 * Reads a cached response for the **currently active** tenant only. That
 * filter is not an optimisation: it is the structural half of the tenant
 * isolation described in `offline-db.ts`, and it holds even if every
 * purge below has failed.
 *
 * Returns `undefined` on a miss, on an expired row, with no active
 * tenant, or on any read error.
 */
export async function readRefCache(params: {
  entity: CacheableEntity;
  queryKey: QueryKey;
  now?: number;
}): Promise<{ data: unknown; fetchedAt: number } | undefined> {
  const { entity, queryKey, now = Date.now() } = params;
  const db = await getOfflineDb();
  const tenantId = getActiveTenant();
  if (!db || !tenantId) return undefined;

  try {
    const row = await db.refCache.get(rowId(tenantId, entity, hashKey(queryKey)));
    if (!row) return undefined;
    if (now - row.fetchedAt > REF_CACHE_TTL_MS) return undefined;
    return { data: row.payload, fetchedAt: row.fetchedAt };
  } catch {
    return undefined;
  }
}

/**
 * The header the service worker stamps onto every response it stores,
 * holding `Date.now()` at cache-write time. Must equal
 * `SW_CACHED_AT_HEADER` in `client-admin/src/pwa/cache-policy.ts`;
 * duplicated rather than imported because `ui` is consumed by every SPA
 * and must not depend on one app's build. Both sides pin the literal in
 * tests.
 *
 * Its presence — not a clock comparison — is what distinguishes a replay
 * of the service worker's cache from a live network response. Deriving
 * that from the server's `Date` header would compare the server's clock
 * against the browser's, so a device running a few minutes fast would
 * label every fresh response stale and show "showing saved data" to a
 * fully-online user, permanently. Unsynced clocks are routine on the
 * low-end Android this epic targets.
 */
const SW_CACHED_AT_HEADER = 'x-sw-cached-at';

/**
 * Wraps a list query's `queryFn` so that:
 *
 * - on success it records the response's true age and caches the body;
 * - on a **network** failure it falls back to the Dexie row, if any.
 *
 * The success path returns exactly what the unwrapped `queryFn` returned,
 * so route loaders and every existing consumer are unaffected.
 *
 * What it deliberately does **not** do: paper over an HTTP error. A 401,
 * 403 or 404 means the server actively refused this request — often
 * because the caller no longer has access to that tenant — and answering
 * it from cache would render data the server just said this user may not
 * see. Those rethrow untouched, as does an aborted request (TanStack
 * Query cancels in-flight fetches on unmount and on key changes; resolving
 * such a fetch with stale data would repopulate a cache entry the app
 * already moved on from).
 */
export function offlineCachedQueryFn<TData>(params: {
  entity: CacheableEntity;
  queryKey: QueryKey;
  /** Receives TanStack Query's own `AbortSignal` — always present on a
   * `queryFn` context, and required (not optional) so it can be handed
   * straight to axios under `exactOptionalPropertyTypes`. */
  fetch: (signal: AbortSignal) => Promise<AxiosResponse<TData>>;
}): (context: { signal: AbortSignal }) => Promise<TData> {
  const { entity, queryKey, fetch } = params;

  return async ({ signal }) => {
    try {
      const res = await fetch(signal);
      // Both values are the browser's own clock, so their difference is
      // a real age rather than a measure of clock skew.
      const stamped = Number(res.headers?.[SW_CACHED_AT_HEADER]);
      const servedFromSwCache = Number.isFinite(stamped) && stamped > 0;
      const fetchedAt = servedFromSwCache ? stamped : Date.now();
      recordFreshness(queryKey, {
        fetchedAt,
        source: servedFromSwCache ? 'sw-cache' : 'network',
      });
      void writeRefCache({ entity, queryKey, data: res.data, fetchedAt });
      return res.data;
    } catch (error) {
      if (!isNoResponseNetworkError(error)) throw error;
      const cached = await readRefCache({ entity, queryKey });
      if (!cached) throw error;
      recordFreshness(queryKey, { fetchedAt: cached.fetchedAt, source: 'dexie' });
      return cached.data as TData;
    }
  };
}

/**
 * True only for "the request never got an answer" — the offline case.
 *
 * `toApiError` (`client.ts`) turns a response *with* a recognisable
 * server body into an `ApiError`, and leaves a bodyless failure as the raw
 * `AxiosError`. So: an `ApiError` is by definition a real HTTP status; an
 * `AxiosError` with a `response` likewise; a cancellation is the caller's
 * own doing. Everything else with no response is a transport failure.
 */
export function isNoResponseNetworkError(error: unknown): boolean {
  if (axios.isCancel(error)) return false;
  if (error instanceof ApiError) return false;
  if (axios.isAxiosError(error)) return error.response === undefined;
  return false;
}
