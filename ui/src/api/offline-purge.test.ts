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
  window.localStorage.clear();
});

/** Waits for the fire-and-forget purge the setters kick off. They are
 * synchronous by contract (see `auth-state.ts`), so the assertion has to
 * wait for the promise they deliberately do not return. */
async function settlePurge(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('setActiveTenant', () => {
  it('purges the leaving tenant’s cached rows on a real switch', async () => {
    setActiveTenant('tenant-a');
    await writeRefCache({ entity: 'students', queryKey: KEY, data: { a: 1 }, fetchedAt: 1 });
    await expect(getOfflineDb()!.refCache.count()).resolves.toBe(1);

    setActiveTenant('tenant-b');
    await settlePurge();

    await expect(getOfflineDb()!.refCache.count()).resolves.toBe(0);
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

    await expect(getOfflineDb()!.refCache.count()).resolves.toBe(1);
  });
});

describe('clearAuthState', () => {
  it('deletes the whole offline database, not just the active tenant’s rows', async () => {
    setActiveTenant('tenant-a');
    await writeRefCache({ entity: 'students', queryKey: KEY, data: { a: 1 }, fetchedAt: 1 });

    clearAuthState();
    await settlePurge();

    // The next person at this browser is a different person.
    await expect(getOfflineDb()!.refCache.count()).resolves.toBe(0);
  });

  it('clears the freshness map', () => {
    setActiveTenant('tenant-a');
    recordFreshness(KEY, { fetchedAt: 1, source: 'dexie' });

    clearAuthState();

    expect(getFreshness(KEY)).toBeUndefined();
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
