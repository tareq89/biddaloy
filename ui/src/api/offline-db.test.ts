/**
 * [8.12.3] Schema/version pinning and the "no IndexedDB here" degradation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteOfflineDb,
  getOfflineDb,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  resetOfflineDbForTests,
} from './offline-db';

beforeEach(async () => {
  // Drains any delete still in flight from the previous test's global
  // cleanup (`clearAuthState()` fires one and does not await it). While a
  // delete is pending `getOfflineDb()` deliberately returns `null` — see
  // `pendingDelete` — so without this a test can be handed no database at
  // all through no fault of its own.
  await deleteOfflineDb();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await deleteOfflineDb();
});

describe('offline database', () => {
  it('is versioned, and the version is a deliberate value', async () => {
    const db = getOfflineDb()!;
    await db.open();

    expect(db.name).toBe(OFFLINE_DB_NAME);
    // Pinned so bumping the schema is a conscious edit in two places — a
    // silent bump would run an upgrade path nobody wrote.
    expect(db.verno).toBe(OFFLINE_DB_VERSION);
    expect(OFFLINE_DB_VERSION).toBe(1);
  });

  it('indexes the columns the tenant purge and eviction actually query', async () => {
    const db = getOfflineDb()!;
    await db.open();

    const indexNames = db.refCache.schema.indexes.map((index) => index.name);
    // `tenantId` backs the tenant-switch purge and `[tenantId+entity]`
    // backs per-entity eviction. Losing either turns a purge into a full
    // table scan — or, worse, into a query Dexie refuses outright.
    expect(indexNames).toContain('tenantId');
    expect(indexNames).toContain('[tenantId+entity]');
    expect(db.refCache.schema.primKey.name).toBe('id');
  });

  it('reuses one connection rather than opening a database per call', () => {
    expect(getOfflineDb()).toBe(getOfflineDb());
  });

  it('returns null where IndexedDB does not exist, instead of throwing', () => {
    resetOfflineDbForTests();
    vi.stubGlobal('indexedDB', undefined);

    // A storage-blocked browser, an SSR pass, a `:node` test — all must
    // get "no cache", not a crash, exactly like `sw-cache.ts` when
    // `caches` is missing.
    expect(getOfflineDb()).toBeNull();

    resetOfflineDbForTests();
  });

  it('hands back no database while a delete is in flight', async () => {
    // The leak this closes: logout fires `deleteOfflineDb()` without
    // awaiting it. If the next session's first cached read opened a new
    // connection during that window, the open would *block*
    // `indexedDB.deleteDatabase`, the delete would never land, and the
    // previous session's rows would survive — served straight back to
    // whoever used the browser next.
    const db = getOfflineDb()!;
    await db.open();

    let releaseDelete: () => void = () => {};
    vi.spyOn(db, 'delete').mockReturnValue(
      new Promise<void>((resolve) => {
        releaseDelete = resolve;
      }) as ReturnType<typeof db.delete>,
    );

    const deleting = deleteOfflineDb();

    expect(getOfflineDb()).toBeNull();

    releaseDelete();
    await deleting;

    // ...and available again once it has landed.
    expect(getOfflineDb()).not.toBeNull();
  });

  it('deleteOfflineDb resolves even when the delete is blocked', async () => {
    const db = getOfflineDb()!;
    await db.open();
    vi.spyOn(db, 'delete').mockRejectedValue(new Error('blocked by another tab'));

    // Logout must not be able to fail on a cache operation.
    await expect(deleteOfflineDb()).resolves.toBeUndefined();
  });

  it('deleteOfflineDb drops the handle so the next call opens a fresh one', async () => {
    const first = getOfflineDb();
    await deleteOfflineDb();

    expect(getOfflineDb()).not.toBe(first);
  });

  it('deleteOfflineDb is a no-op with no IndexedDB at all', async () => {
    resetOfflineDbForTests();
    vi.stubGlobal('indexedDB', undefined);

    await expect(deleteOfflineDb()).resolves.toBeUndefined();
    resetOfflineDbForTests();
  });
});
