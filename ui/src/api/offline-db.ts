/**
 * [8.12.3] Tier 2 of the offline strategy: a versioned IndexedDB store
 * (via Dexie) holding **reference data only**, so a staff member whose
 * connection drops mid-shift still sees the student, class, section and
 * fee-structure lists they had loaded — and sees them *labelled* with how
 * old they are.
 *
 * ## How this relates to the service worker cache (#180)
 *
 * It complements it; it does not replace it. `client-admin/src/sw.ts`
 * keeps its `NetworkFirst` route over every `GET /api/v1/*` and is not
 * touched by this issue.
 *
 * ```text
 *   queryFn ──▶ axios ──▶ [service worker: NetworkFirst api-cache] ──▶ network
 *      │                        (transparent HTTP-response layer)
 *      └── on a *no-response* network error ──▶ this Dexie store
 *                                  (structured rows, known `fetchedAt`)
 * ```
 *
 * | | SW `api-cache` | this store |
 * |---|---|---|
 * | Level | HTTP responses, transparent | structured app data, explicit |
 * | Scope | every `GET /api/v1/*` | 4 reference entities |
 * | Knows the data's age? | no | yes (`fetchedAt` per row) |
 * | Works with no SW at all? | no | yes |
 *
 * ## Tenant isolation
 *
 * Two independent mechanisms, exactly like `sw-cache.ts`, because a single
 * silent failure here shows one school's students under another school's
 * name:
 *
 * 1. **Key scoping (structural).** Every row's primary key begins with the
 *    tenant id, and every read in `offline-cache.ts` is filtered on the
 *    *currently active* tenant. A cross-tenant hit is impossible even if
 *    the purge below never ran. This mirrors `apiCacheKeyFor`'s `__tenant`
 *    key parameter on the service-worker side.
 * 2. **Purge (best effort).** `auth-state.ts` deletes the previous
 *    tenant's rows on a real tenant switch, and deletes the whole database
 *    on logout/session expiry — the same two funnels `clearApiCache()`
 *    already uses.
 *
 * ## Schema versioning
 *
 * `version(1)` is the current schema. A future change adds
 * `db.version(2).stores({...}).upgrade(async (tx) => { ... })` *below*
 * the `version(1)` call rather than editing it — Dexie replays the version
 * chain for a browser that still holds an older database, and rewriting
 * version 1 in place leaves those browsers on a schema that no longer
 * matches the code. `OFFLINE_DB_VERSION` is asserted by the unit tests so
 * the bump is deliberate rather than accidental.
 */
import type Dexie from 'dexie';
import type { Table } from 'dexie';

/**
 * The only entities this cache will ever serve.
 *
 * **Money-adjacent reads are deliberately absent and must stay absent.**
 * Fee dues, invoices and payments are excluded on purpose: showing a
 * yesterday-old balance without the user knowing it is yesterday's is how
 * a school takes a payment twice, or refuses a receipt it already issued.
 * This union is the enforcement — `offlineCachedQueryFn` only accepts a
 * `CacheableEntity`, so wrapping `feeDuesQueryOptions`, `invoicesQuery
 * Options` or any payment query is a *type error*, not a judgement call.
 * If a later issue genuinely needs one, it must first build the "this
 * figure is N hours old, do not act on it" affordance the epic asks for.
 */
export type CacheableEntity = 'students' | 'classes' | 'class-sections' | 'fee-structures';

/** One cached list response. */
export interface RefCacheRow {
  /**
   * `${tenantId} ${entity} ${queryHash}`. The tenant id comes
   * first so a tenant purge is a prefix range scan, and so the key itself
   * — not just the query that reads it — carries the isolation.
   */
  id: string;
  tenantId: string;
  entity: CacheableEntity;
  /** `hashKey(queryKey)` from TanStack Query: the same filters/page that
   * produced this response. Different filter combinations are different
   * rows, which is why per-entity eviction is needed at all. */
  queryHash: string;
  /** Epoch ms. Derived from the response's `Date` header where present,
   * so a response the service worker served from *its* cache is dated
   * when the server produced it, not when we read it back. */
  fetchedAt: number;
  /** The unwrapped response body (`res.data`), structured-cloned by
   * IndexedDB. Typed `unknown` because one table holds four different
   * response shapes; the reader casts against its own query's type. */
  payload: unknown;
}

/** The entities [8.12.4]'s mutation queue will ever replay.
 *
 * Closed on purpose, exactly like `CacheableEntity` above and for a
 * harsher reason: a *queued* mutation is sent minutes or hours later,
 * from a tab whose user has already walked away. That is survivable for
 * an attendance mark and unrecoverable for money — a payment that
 * replays after the parent was handed a receipt, a fee generation that
 * runs twice, an invoice created against a term that has since closed,
 * an enrolment change applied after the student was transferred.
 *
 * So: **never add `payments`, `fee-generation`, `invoices` or
 * `enrollments` here.** `enqueueMutation` only accepts a
 * `QueueableEntity`, which makes queuing one of those a compile error
 * rather than something a reviewer has to catch. A path-shaped runtime
 * guard (`FORBIDDEN_QUEUE_PATH` in `mutation-queue.ts`) covers the same
 * ground for paths built at runtime, because a `string` path can say
 * `/payments` while the `entity` field says something innocent.
 *
 * `enrollments` being forbidden here says nothing about *reads*: class
 * and section reference data is legitimately cached above. Reads are
 * reproducible; writes are not.
 *
 * `attendance` is the anticipated first consumer (8.12.4's epic names
 * client-teacher attendance). Its endpoints do not exist in
 * `server/openapi.json` yet — see `mutation-queue.ts`'s header.
 */
export type QueueableEntity = 'attendance';

/** The HTTP verbs a queued mutation can replay with. No `get`: a read is
 * not a mutation, and replaying one would have nowhere to put the
 * answer. */
export type QueuedMutationMethod = 'post' | 'patch' | 'put' | 'delete';

/**
 * `pending` — waiting to be replayed.
 * `conflict` — the server answered 409/412: the world moved on while
 *   this was queued, and a human has to decide. Never silently retried.
 * `dead` — failed `MAX_REPLAY_ATTEMPTS` times. Kept, not dropped: the
 *   row is the user's work, and 8.12.5's UI offers retry/discard.
 */
export type QueuedMutationStatus = 'pending' | 'conflict' | 'dead';

/** One queued mutation. */
export interface QueuedMutationRow {
  /** Dexie auto-increment (`++seq`). **This is the ordering guarantee**:
   * replay walks rows in ascending `seq`, which is enqueue order. */
  seq?: number;
  /** The tenant that was active at enqueue time. Replay and every
   * snapshot filter on this, so a row queued under school A can never be
   * sent — or even counted — while school B is active. */
  tenantId: string;
  entity: QueueableEntity;
  method: QueuedMutationMethod;
  /** `apiClient`-relative, e.g. `/attendance` — the same string the
   * calling code would have passed to `apiClient.post`. */
  path: string;
  /** The request body, structured-cloned by IndexedDB. `unknown` for the
   * same reason `RefCacheRow.payload` is. */
  body: unknown;
  enqueuedAt: number;
  /** Counts *server-answered* failures only. Being offline is not a
   * strike — see `replayQueue`. */
  attempts: number;
  status: QueuedMutationStatus;
  lastError?: { statusCode?: number; message: string };
}

export const OFFLINE_DB_NAME = 'biddaloy-offline';
export const OFFLINE_DB_VERSION = 2;

/**
 * The database class, built behind a **dynamic import** of Dexie.
 *
 * Dexie is ~35 KB gzipped and, imported statically, it lands in the entry
 * chunk — 15% of the app's whole first-load budget, paid by every user on
 * every first visit, for a store that only matters once they lose their
 * connection. On the mid-range Android on 3G this epic targets, that is
 * the opposite of the point.
 *
 * So the class is declared *inside* the loader: `class X extends Dexie`
 * needs the constructor as a value, which a static import would pull into
 * the entry. Every caller is already `async`, so this costs nothing at the
 * call sites, and the promise is memoised so the module loads once.
 */
type OfflineDbCtor = new () => OfflineDb;

export interface OfflineDb extends Dexie {
  refCache: Table<RefCacheRow, string>;
  mutationQueue: Table<QueuedMutationRow, number>;
}

let ctorPromise: Promise<OfflineDbCtor> | null = null;

function loadOfflineDbCtor(): Promise<OfflineDbCtor> {
  ctorPromise ??= import('dexie').then(({ default: Dexie }) => {
    class OfflineDbImpl extends Dexie {
      refCache!: Table<RefCacheRow, string>;
      mutationQueue!: Table<QueuedMutationRow, number>;

      constructor() {
        super(OFFLINE_DB_NAME);
        // `id` is the primary key; `[tenantId+entity]` backs both eviction
        // (newest-20-per-pair) and the tenant purge; `tenantId` alone backs
        // the purge when a tenant is switched away from.
        this.version(1).stores({
          refCache: 'id, tenantId, [tenantId+entity], fetchedAt',
        });
        // [8.12.4]: appended below `version(1)`, never edited into it — see
        // the "Schema versioning" section of this file's header. A browser
        // still holding v1 replays the chain from where it is.
        //
        // No `.upgrade()` callback: this version only *adds* a table, and an
        // empty new table has no data to migrate. `refCache` is omitted
        // because Dexie carries unchanged tables forward untouched (the
        // upgrade test proves a v1 row survives).
        //
        // `++seq` is the auto-increment primary key and therefore the
        // ordering guarantee; `[tenantId+status]` is the exact index replay
        // and `getQueueSnapshot` query on, so neither ever scans another
        // tenant's rows.
        this.version(OFFLINE_DB_VERSION).stores({
          mutationQueue: '++seq, tenantId, [tenantId+status]',
        });
      }
    }
    return OfflineDbImpl;
  });
  return ctorPromise;
}

/**
 * `undefined` = not yet attempted, `null` = unavailable in this
 * environment (see below). Lazy rather than constructed at module load:
 * importing `@biddaloy/ui/api` must not open a database as a side effect,
 * least of all in a test or SSR context that never uses one.
 */
let dbInstance: OfflineDb | null | undefined;

/**
 * Set while `deleteOfflineDb()` is in flight. Reads and writes no-op for
 * that window instead of opening a fresh connection.
 *
 * Without it, a logout's fire-and-forget delete races the next session:
 * the new user's first cached read opens a new connection, which *blocks*
 * `indexedDB.deleteDatabase`, the delete never completes, and the previous
 * session's rows survive. Two staff at the same school sharing a browser
 * would then be served their predecessor's data — precisely the guarantee
 * `clearAuthState()` exists to make. Skipping the cache for the few
 * milliseconds a delete takes costs nothing; leaking a session's data
 * costs everything.
 */
let pendingDelete: Promise<void> | null = null;

/**
 * Returns the database, or `null` where IndexedDB does not exist — Node
 * without a polyfill, an SSR pass, a browser in a storage-blocked
 * context. Constructing the `Dexie` instance itself never touches
 * storage (Dexie opens lazily on first query), so there is nothing to
 * fail here beyond the check above; every *use* site in
 * `offline-cache.ts` has its own `try`/`catch` for the open/read/write
 * failures that do happen at runtime. Every caller in
 * `offline-cache.ts` treats `null` as "no cache", exactly the way
 * `sw-cache.ts` no-ops when `caches` is absent: an offline *cache* going
 * missing must never break the online path that is the real feature.
 */
export async function getOfflineDb(): Promise<OfflineDb | null> {
  // Never hand back a connection while a delete is landing — opening one
  // would block the delete outright. See `pendingDelete`.
  if (pendingDelete) return null;
  if (dbInstance !== undefined) return dbInstance;
  if (typeof indexedDB === 'undefined') {
    dbInstance = null;
    return dbInstance;
  }

  const Ctor = await loadOfflineDbCtor();
  // Re-checked after the await: a logout can start a delete while the
  // Dexie chunk is still downloading, and opening a connection then is
  // exactly the race `pendingDelete` exists to prevent.
  if (pendingDelete) return null;
  dbInstance ??= new Ctor();
  return dbInstance;
}

/**
 * Closes and deletes the entire database — the logout/session-expiry
 * purge. Resolves even on failure (Dexie rejects a delete that is blocked
 * by another open tab); the caller is a synchronous state setter with no
 * useful recovery, and the tenant-scoped keys still make the leftover rows
 * unreadable under a different tenant.
 */
export async function deleteOfflineDb(): Promise<void> {
  // Join an in-flight delete rather than starting a second one. Callers
  // are a mix of fire-and-forget (`clearAuthState`) and awaited, so
  // without this an awaited call could return while an un-awaited one was
  // still running — and the caller would reasonably believe the store was
  // gone when it was moments from being deleted again.
  if (pendingDelete) return pendingDelete;

  // Both of these happen **synchronously**, before the first `await`.
  // `getOfflineDb()` became async when Dexie moved behind a dynamic
  // import, so awaiting anything first would leave a window in which a
  // concurrent read opens a fresh connection — and an open connection
  // blocks `deleteDatabase` outright, which is the leak `pendingDelete`
  // exists to prevent.
  const existing = dbInstance ?? undefined;
  dbInstance = undefined;

  pendingDelete = (async () => {
    try {
      if (existing) {
        await existing.delete();
        return;
      }
      // Nothing open in this tab: delete the underlying database directly
      // rather than loading the Dexie chunk purely to throw it away. This
      // is the common case at logout — a session that never touched the
      // offline store still must not leave one behind.
      await deleteDatabaseDirectly();
    } catch {
      // Swallowed on purpose — see this function's own comment.
    }
  })();

  try {
    await pendingDelete;
  } finally {
    pendingDelete = null;
  }
}

/** `indexedDB.deleteDatabase` as a promise. Resolves on `blocked` too:
 * another tab holding the database open is not something this tab can
 * fix, and the tenant-scoped keys mean the rows left behind are
 * unreadable under any other session anyway. */
function deleteDatabaseDirectly(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** Test-only: drops the memoized handle so the next `getOfflineDb()`
 * re-evaluates the environment (used by the `indexedDB`-absent tests). */
export function resetOfflineDbForTests(): void {
  dbInstance = undefined;
  pendingDelete = null;
}

/**
 * Deletes every row belonging to one tenant — the tenant-switch purge.
 * Fire-and-forget; see `deleteOfflineDb` on why a failure here is
 * survivable.
 *
 * Lives here rather than in `offline-cache.ts` so that `auth-state.ts`,
 * which calls it, needs to import only this module. `offline-cache.ts`
 * imports `auth-state` for the active tenant, so the other arrangement
 * made a cycle through the one code path where a silent failure is a
 * cross-tenant data leak.
 */
export async function purgeTenantRefCache(tenantId: string): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;
  try {
    await db.refCache.where('tenantId').equals(tenantId).delete();
  } catch {
    // Rows left behind are unreadable under any other tenant (the key
    // begins with the tenant id) and expire within 24h anyway.
  }
}
