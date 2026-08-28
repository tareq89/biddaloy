// [8.12.6] Browser-side probes for the PWA suite: service-worker
// control, the two Cache Storage caches, and the Dexie database.
//
// Everything here runs inside `page.evaluate`, against the *shipped*
// bundle — there is no import of app code at runtime, so every literal
// below (cache names, database name, store names, the `__tenant` key
// parameter) is pinned to the constants the app defines and named next
// to its source of truth:
//
//   - `api-cache` / `asset-cache` — `client-admin/src/pwa/cache-policy.ts`
//   - `__tenant=<X-Tenant-ID|none>` — `apiCacheKeyFor`, same file
//   - `biddaloy-offline` / `refCache` / `mutationQueue` —
//     `ui/src/api/offline-db.ts`
//
// A rename on either side breaks these helpers loudly (a missing cache, a
// missing object store), which is the intent: they are a second copy, so
// they must fail rather than quietly probe nothing.
import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { createClassSection, type ApiSession } from '../api';

const API_CACHE_NAME = 'api-cache';
export const ASSET_CACHE_NAME = 'asset-cache';
const MUTATION_QUEUE_STORE = 'mutationQueue';
const REF_CACHE_STORE = 'refCache';

/** Mirrors `QueuedMutationRow` (`ui/src/api/offline-db.ts`) as far as the
 * suite needs it. Re-declared rather than imported: `e2e/` is not a
 * workspace and does not resolve `@biddaloy/ui`. */
export interface QueueRow {
  seq: number;
  tenantId: string;
  entity: string;
  method: string;
  path: string;
  body: unknown;
  enqueuedAt: number;
  attempts: number;
  status: 'pending' | 'conflict' | 'dead';
  lastError?: { statusCode?: number; message: string };
}

export interface SeedQueueRow {
  tenantId: string;
  /** Always `'attendance'` — the only member of `QueueableEntity`, and
   * the only value `sync.entity.*` has a label for. The *path* is what
   * these specs actually vary. */
  entity?: string;
  method: 'post' | 'patch' | 'put' | 'delete';
  /** `apiClient`-relative, e.g. `/students/<id>`.
   *
   * **Money paths are forbidden here, exactly as they are in
   * `enqueueMutation`.** Seeding writes straight into IndexedDB and
   * therefore bypasses both of that function's guards
   * (`QueueableEntity` at compile time, `FORBIDDEN_QUEUE_PATH` at
   * runtime). Never seed `/payments`, `/invoices`, `/enrollments` or
   * `/fees/generate` — a spec that did would "prove" a replayed payment
   * works, which is the one behaviour the queue is built to make
   * impossible. */
  path: string;
  body?: unknown;
}

/** Resolves once a service worker is registered, activated **and**
 * controlling this page — all three, because a registered-but-not-
 * controlling worker serves nothing, which is precisely the failure mode
 * an offline spec would otherwise misread as "cache empty". */
export async function waitForSwControl(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) throw new Error('service worker registered but not active');
    if (!navigator.serviceWorker.controller) {
      // `clientsClaim()` (`client-admin/src/sw.ts`) makes this arrive on
      // the very first load, but it is still an event, not a guarantee at
      // the moment `ready` resolves.
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        });
      });
    }
    const controller = navigator.serviceWorker.controller;
    if (!controller) throw new Error('service worker never took control of this page');
    return controller.scriptURL;
  });
}

/** Every key currently in a Cache Storage cache, as URL strings. Returns
 * `[]` for a cache that does not exist yet. */
export async function cacheKeys(page: Page, cacheName: string): Promise<string[]> {
  return page.evaluate(async (name) => {
    if (!(await caches.has(name))) return [];
    const cache = await caches.open(name);
    return (await cache.keys()).map((request) => request.url);
  }, cacheName);
}

/** API-cache keys for one tenant — `apiCacheKeyFor` folds the
 * `X-Tenant-ID` header into a `__tenant` search param precisely so this
 * question can be asked. */
export async function apiCacheKeysForTenant(page: Page, tenantId: string): Promise<string[]> {
  const keys = await cacheKeys(page, API_CACHE_NAME);
  return keys.filter((url) => new URL(url).searchParams.get('__tenant') === tenantId);
}

/** The tenant the SPA is currently acting as, read from the same
 * localStorage entry `tenant-storage.ts` persists. */
export async function activeTenantId(page: Page): Promise<string> {
  const raw = await page.evaluate(() => window.localStorage.getItem('biddaloy:activeTenant'));
  if (!raw) throw new Error('no persisted active tenant — is this page logged in?');
  const parsed = JSON.parse(raw) as { tenantId?: string };
  if (!parsed.tenantId) throw new Error(`persisted tenant has no tenantId: ${raw}`);
  return parsed.tenantId;
}

/**
 * One browser-side entry point for every IndexedDB probe, because a
 * `page.evaluate` callback is serialised and cannot close over anything
 * defined out here — so the "open the database" logic has to live inside
 * a single evaluated function rather than be shared between several.
 *
 * The database is opened **without a version number**, which means it can
 * only ever attach to a database the app itself created, and a missing
 * object store throws instead of being created: a spec that probed a
 * database of its own making would pass against an app that never opened
 * one.
 */
async function idbOp<T>(
  page: Page,
  args: { store: string; action: 'getAll' | 'getAllKeys' | 'add'; value?: unknown },
): Promise<T> {
  return page.evaluate(async ({ store, action, value }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('biddaloy-offline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => reject(new Error('biddaloy-offline did not exist yet'));
    });
    try {
      if (!db.objectStoreNames.contains(store)) {
        throw new Error(`object store ${store} missing from biddaloy-offline`);
      }
      return await new Promise<unknown>((resolve, reject) => {
        const objectStore = db
          .transaction(store, action === 'add' ? 'readwrite' : 'readonly')
          .objectStore(store);
        const request =
          action === 'add'
            ? objectStore.add(value)
            : action === 'getAllKeys'
              ? objectStore.getAllKeys()
              : objectStore.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, args) as Promise<T>;
}

/**
 * Waits until the *app* has created the offline database and the store
 * exists. The Dexie handle is lazy (`offline-db.ts` opens it on first
 * use, which for a staff screen is `SyncStatusIndicator` reading the
 * queue snapshot), so seeding immediately after `goto` can otherwise race
 * the app and write into a database Dexie is about to upgrade.
 */
export async function waitForOfflineDb(page: Page, store = MUTATION_QUEUE_STORE): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async (storeName) => {
          const names = await indexedDB.databases?.();
          if (names && !names.some((entry) => entry.name === 'biddaloy-offline')) return false;
          return new Promise<boolean>((resolve) => {
            const request = indexedDB.open('biddaloy-offline');
            request.onupgradeneeded = () => {
              // Someone (this probe) is about to create it — the app has
              // not opened it yet. Abort so the probe never becomes the
              // creator.
              request.transaction?.abort();
              resolve(false);
            };
            request.onsuccess = () => {
              const db = request.result;
              const has = db.objectStoreNames.contains(storeName);
              db.close();
              resolve(has);
            };
            request.onerror = () => resolve(false);
          });
        }, store),
      { message: `the app should have opened biddaloy-offline with a ${store} store` },
    )
    .toBe(true);
}

/** Every queued mutation in the database, ascending `seq` — replay order.
 * Not tenant-filtered: a spec asserting isolation needs to see the rows
 * the UI is *not* showing. */
export async function readQueueRows(page: Page): Promise<QueueRow[]> {
  const rows = await idbOp<QueueRow[]>(page, { store: MUTATION_QUEUE_STORE, action: 'getAll' });
  return rows.sort((a, b) => a.seq - b.seq);
}

/**
 * Writes one schema-valid row straight into `mutationQueue`.
 *
 * Why the specs do this instead of driving the UI: **nothing in the
 * product enqueues a mutation yet.** `enqueueMutation` has no caller
 * (`ui/src/api/mutation-queue.ts`'s header says so — the anticipated
 * consumer is client-teacher attendance, and neither the app nor the
 * endpoints exist). The replay engine still ships and still runs on every
 * `online` event, so it is tested here against real server endpoints, in
 * a real browser, by seeding its input. When a real consumer lands, these
 * specs should drive it instead and this helper should go.
 */
export async function seedQueueRow(page: Page, row: SeedQueueRow): Promise<void> {
  await idbOp(page, {
    store: MUTATION_QUEUE_STORE,
    action: 'add',
    value: {
      tenantId: row.tenantId,
      entity: row.entity ?? 'attendance',
      method: row.method,
      path: row.path,
      body: row.body ?? {},
      enqueuedAt: Date.now(),
      attempts: 0,
      status: 'pending',
    },
  });
}

/** Primary keys in `refCache`. Every key begins with the tenant id
 * (`${tenantId} ${entity} ${queryHash}` — `offline-db.ts`), which is what
 * makes the tenant purge a prefix question. */
async function refCacheKeys(page: Page): Promise<string[]> {
  return idbOp<string[]>(page, { store: REF_CACHE_STORE, action: 'getAllKeys' });
}

export async function refCacheKeysForTenant(page: Page, tenantId: string): Promise<string[]> {
  const keys = await refCacheKeys(page);
  return keys.filter((key) => key.startsWith(`${tenantId} `));
}

/** `GET /api/v1/students/:id` with an explicit admin session — used to
 * assert, from outside the browser, that a replayed mutation actually
 * reached the database. */
export async function fetchStudent(
  request: APIRequestContext,
  session: ApiSession,
  studentId: string,
): Promise<{ home_address?: string | null }> {
  const response = await request.get(`/api/v1/students/${studentId}`, {
    headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
  });
  if (!response.ok()) {
    throw new Error(`GET /students/${studentId}: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as { home_address?: string | null };
}

/** A student in a freshly-created class section, returning the whole
 * chain — the section is what `conflict` coverage deletes (a section with
 * an active student in it is a real, reproducible `409` from
 * `classes.service.ts`). */
export async function createStudentInOwnSection(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
): Promise<{ studentId: string; classId: string; sectionId: string }> {
  const chain = await createClassSection(request, session);
  const response = await request.post('/api/v1/students', {
    headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
    data: { full_name: fullName, class_section_id: chain.sectionId },
  });
  if (!response.ok()) {
    throw new Error(`POST /students: ${response.status()} ${await response.text()}`);
  }
  const student = (await response.json()) as { id: string };
  return { studentId: student.id, classId: chain.classId, sectionId: chain.sectionId };
}
