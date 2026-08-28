/**
 * [8.12.3] Schema/version pinning and the "no IndexedDB here" degradation.
 */
import Dexie from 'dexie';
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
    const db = (await getOfflineDb())!;
    await db.open();

    expect(db.name).toBe(OFFLINE_DB_NAME);
    // Pinned so bumping the schema is a conscious edit in two places — a
    // silent bump would run an upgrade path nobody wrote.
    expect(db.verno).toBe(OFFLINE_DB_VERSION);
    // [8.12.4] bumped this to 2 to add `mutationQueue`. Bumping the pin
    // is the deliberate edit — do it in the same change as the schema,
    // and with an upgrade test like the one below.
    expect(OFFLINE_DB_VERSION).toBe(2);
  });

  it('indexes the mutation queue on the columns replay actually queries', async () => {
    const db = (await getOfflineDb())!;
    await db.open();

    const indexNames = db.mutationQueue.schema.indexes.map((index) => index.name);
    expect(indexNames).toContain('tenantId');
    expect(indexNames).toContain('[tenantId+status]');
    // `++seq` is not decoration: replay walks rows in ascending primary
    // key, so the auto-increment *is* the submission-order guarantee.
    expect(db.mutationQueue.schema.primKey.name).toBe('seq');
    expect(db.mutationQueue.schema.primKey.auto).toBe(true);
  });

  it('upgrades a v1 database in place, keeping the rows already in it', async () => {
    // The one change here that can hurt somebody: every browser holding
    // v1 replays the version chain on next open. If the upgrade dropped
    // `refCache`, a staff member's offline reference data would vanish
    // on a deploy they never asked for.
    const v1 = new Dexie(OFFLINE_DB_NAME);
    v1.version(1).stores({ refCache: 'id, tenantId, [tenantId+entity], fetchedAt' });
    await v1.open();
    await v1.table('refCache').put({
      id: 'tenant-a students hash',
      tenantId: 'tenant-a',
      entity: 'students',
      queryHash: 'hash',
      fetchedAt: 1,
      payload: { items: [] },
    });
    v1.close();
    resetOfflineDbForTests();

    const db = (await getOfflineDb())!;
    await db.open();

    expect(db.verno).toBe(2);
    await expect(db.refCache.get('tenant-a students hash')).resolves.toMatchObject({
      tenantId: 'tenant-a',
    });
    // ...and the new table exists and is empty, which is why no
    // `.upgrade()` callback was needed.
    await expect(db.mutationQueue.count()).resolves.toBe(0);
  });

  it('indexes the columns the tenant purge and eviction actually query', async () => {
    const db = (await getOfflineDb())!;
    await db.open();

    const indexNames = db.refCache.schema.indexes.map((index) => index.name);
    // `tenantId` backs the tenant-switch purge and `[tenantId+entity]`
    // backs per-entity eviction. Losing either turns a purge into a full
    // table scan — or, worse, into a query Dexie refuses outright.
    expect(indexNames).toContain('tenantId');
    expect(indexNames).toContain('[tenantId+entity]');
    expect(db.refCache.schema.primKey.name).toBe('id');
  });

  it('reuses one connection rather than opening a database per call', async () => {
    expect(await getOfflineDb()).toBe(await getOfflineDb());
  });

  it('returns null where IndexedDB does not exist, instead of throwing', async () => {
    resetOfflineDbForTests();
    vi.stubGlobal('indexedDB', undefined);

    // A storage-blocked browser, an SSR pass, a `:node` test — all must
    // get "no cache", not a crash, exactly like `sw-cache.ts` when
    // `caches` is missing.
    expect(await getOfflineDb()).toBeNull();

    resetOfflineDbForTests();
  });

  it('hands back no database while a delete is in flight', async () => {
    // The leak this closes: logout fires `deleteOfflineDb()` without
    // awaiting it. If the next session's first cached read opened a new
    // connection during that window, the open would *block*
    // `indexedDB.deleteDatabase`, the delete would never land, and the
    // previous session's rows would survive — served straight back to
    // whoever used the browser next.
    const db = (await getOfflineDb())!;
    await db.open();

    let releaseDelete: () => void = () => {};
    vi.spyOn(db, 'delete').mockReturnValue(
      new Promise<void>((resolve) => {
        releaseDelete = resolve;
      }) as ReturnType<typeof db.delete>,
    );

    const deleting = deleteOfflineDb();

    expect(await getOfflineDb()).toBeNull();

    releaseDelete();
    await deleting;

    // ...and available again once it has landed.
    expect(await getOfflineDb()).not.toBeNull();
  });

  it('deleteOfflineDb resolves even when the delete is blocked', async () => {
    const db = (await getOfflineDb())!;
    await db.open();
    vi.spyOn(db, 'delete').mockRejectedValue(new Error('blocked by another tab'));

    // Logout must not be able to fail on a cache operation.
    await expect(deleteOfflineDb()).resolves.toBeUndefined();
  });

  it('deleteOfflineDb drops the handle so the next call opens a fresh one', async () => {
    const first = await getOfflineDb();
    await deleteOfflineDb();

    expect(await getOfflineDb()).not.toBe(first);
  });

  it('deleteOfflineDb is a no-op with no IndexedDB at all', async () => {
    resetOfflineDbForTests();
    vi.stubGlobal('indexedDB', undefined);

    await expect(deleteOfflineDb()).resolves.toBeUndefined();
    resetOfflineDbForTests();
  });
});
