/**
 * [8.12.3] The tenant-isolation acceptance criterion, tested at the funnel
 * rather than at the individual purge function: "switching tenant purges
 * the previous tenant's cache" and "logout purges all cached data" are
 * claims about `setActiveTenant` and `clearAuthState` — the two entry
 * points every switch, logout, session expiry and failed refresh already
 * passes through, and the same two `clearApiCache()` uses.
 *
 * A purge function that works but is never called is exactly the silent
 * failure the epic warns about, so these tests call the setters, not the
 * purges.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAuthState, setActiveTenant, getActiveTenant } from './auth-state';
import { FORM_DRAFT_KEY_PREFIX, formDraftKey } from './form-draft-storage';
import { getFreshness, recordFreshness } from './freshness';
import { enqueueMutation } from './mutation-queue';
import { writeRefCache } from './offline-cache';
import { deleteOfflineDb, getOfflineDb } from './offline-db';

const KEY = ['students', 'list', {}];

beforeEach(async () => {
  // See `offline-cache.test.ts` on why the previous test's fire-and-forget
  // delete has to be drained before this one seeds anything.
  await deleteOfflineDb();
  window.localStorage.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise((resolve) => setTimeout(resolve, 0));
  clearAuthState();
  // Awaited, not left in flight. `clearAuthState()` fires the database
  // delete without awaiting it, so leaving it running lets it land inside
  // the *next* test and wipe rows that test just seeded. Same fix as
  // `offline-cache.test.ts`'s teardown; joining here is cheap because
  // `deleteOfflineDb()` reuses an in-flight delete rather than starting a
  // second one.
  await deleteOfflineDb();
  window.localStorage.clear();
});

/** Waits for the fire-and-forget purge the setters kick off. They are
 * synchronous by contract (see `auth-state.ts`), so the assertion has to
 * wait for the promise they deliberately do not return. */
async function settlePurge(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** For the logout assertions specifically: `clearAuthState()` fires
 * `deleteOfflineDb()` without awaiting it, and a whole-database delete
 * can outlive a single macrotask on a loaded machine. `getOfflineDb()`
 * deliberately returns `null` while one is in flight, so a test that
 * only waited a tick would read `null.refCache` rather than a count.
 * `deleteOfflineDb()` joins the in-flight delete instead of starting a
 * second one — that is exactly what its `pendingDelete` guard is for. */
async function settleDatabaseDelete(): Promise<void> {
  await settlePurge();
  await deleteOfflineDb();
}

describe('setActiveTenant', () => {
  it('purges the leaving tenant’s cached rows on a real switch', async () => {
    setActiveTenant('tenant-a');
    await writeRefCache({ entity: 'students', queryKey: KEY, data: { a: 1 }, fetchedAt: 1 });
    await expect((await getOfflineDb())!.refCache.count()).resolves.toBe(1);

    setActiveTenant('tenant-b');
    await settlePurge();

    await expect((await getOfflineDb())!.refCache.count()).resolves.toBe(0);
  });

  it('clears the freshness map on a switch, so no age label survives it', () => {
    setActiveTenant('tenant-a');
    recordFreshness(KEY, { fetchedAt: 1, source: 'dexie' });

    setActiveTenant('tenant-b');

    // "Loaded 3 minutes ago" under a different school's data is a lie
    // about where the number came from, not a cosmetic staleness bug.
    expect(getFreshness(KEY)).toBeUndefined();
  });

  it('does not purge on the cold-boot restore of the first tenant', async () => {
    // `activeTenantId` is still null here — [8.9.5]'s restore sets the
    // first tenant, and throwing away a cache that is still correct would
    // make every reload a cold start.
    clearAuthState();
    await settlePurge();
    setActiveTenant('tenant-a');
    await writeRefCache({ entity: 'students', queryKey: KEY, data: { a: 1 }, fetchedAt: 1 });

    setActiveTenant('tenant-a');
    await settlePurge();

    await expect((await getOfflineDb())!.refCache.count()).resolves.toBe(1);
  });
});

describe('clearAuthState', () => {
  it('deletes the whole offline database, not just the active tenant’s rows', async () => {
    setActiveTenant('tenant-a');
    await writeRefCache({ entity: 'students', queryKey: KEY, data: { a: 1 }, fetchedAt: 1 });

    clearAuthState();
    await settleDatabaseDelete();

    // The next person at this browser is a different person.
    await expect((await getOfflineDb())!.refCache.count()).resolves.toBe(0);
  });

  it('clears the freshness map', () => {
    setActiveTenant('tenant-a');
    recordFreshness(KEY, { fetchedAt: 1, source: 'dexie' });

    clearAuthState();

    expect(getFreshness(KEY)).toBeUndefined();
  });

  it('takes [8.12.4]’s queued mutations with it', async () => {
    setActiveTenant('tenant-a');
    await enqueueMutation({ entity: 'attendance', method: 'post', path: '/attendance' });
    await expect((await getOfflineDb())!.mutationQueue.count()).resolves.toBe(1);

    clearAuthState();
    await settleDatabaseDelete();

    // No queue-specific purge code exists, and that is the point: the
    // queue lives in the database `clearAuthState()` already deletes
    // whole. One funnel, nothing to forget to wire up.
    await expect((await getOfflineDb())!.mutationQueue.count()).resolves.toBe(0);
  });

  it('removes every autosaved form draft, for every tenant', () => {
    setActiveTenant('tenant-a');
    window.localStorage.setItem(
      formDraftKey('student-new', getActiveTenant()),
      '{"full_name":"Ayesha"}',
    );
    setActiveTenant('tenant-b');
    window.localStorage.setItem(
      formDraftKey('student-new', getActiveTenant()),
      '{"full_name":"Rahim"}',
    );
    window.localStorage.setItem('unrelated', 'keep me');

    clearAuthState();

    const remaining = Object.keys(window.localStorage);
    expect(remaining.filter((key) => key.startsWith(FORM_DRAFT_KEY_PREFIX))).toEqual([]);
    // Scoped removal, not a blanket `localStorage.clear()` — the locale
    // preference and other unrelated keys are not ours to delete.
    expect(window.localStorage.getItem('unrelated')).toBe('keep me');
  });
});
