import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearFreshness, getFreshness, recordFreshness, subscribeFreshness } from './freshness';

const KEY = ['students', 'list', { page: 1 }];

afterEach(() => {
  clearFreshness();
});

describe('freshness side channel', () => {
  it('is keyed by query-key value, not identity', () => {
    recordFreshness(['students', 'list', { page: 1 }], { fetchedAt: 5, source: 'dexie' });

    // A key factory builds a fresh array on every render; looking it up
    // by reference would report "no age" for the very query that just
    // recorded one.
    expect(getFreshness(['students', 'list', { page: 1 }])).toEqual({
      fetchedAt: 5,
      source: 'dexie',
    });
  });

  it('keeps different filter combinations apart', () => {
    recordFreshness(['students', 'list', { page: 1 }], { fetchedAt: 5, source: 'dexie' });

    expect(getFreshness(['students', 'list', { page: 2 }])).toBeUndefined();
  });

  it('notifies subscribers when an entry changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFreshness(listener);

    recordFreshness(KEY, { fetchedAt: 1, source: 'network' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    recordFreshness(KEY, { fetchedAt: 2, source: 'network' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when a refetch reports the identical age and source', () => {
    recordFreshness(KEY, { fetchedAt: 1, source: 'network' });
    const listener = vi.fn();
    subscribeFreshness(listener);

    recordFreshness(KEY, { fetchedAt: 1, source: 'network' });

    // A poll that keeps returning the same server `Date` would otherwise
    // re-render every consumer on every tick for no visible change.
    expect(listener).not.toHaveBeenCalled();
  });

  it('clearFreshness drops every entry and notifies once', () => {
    recordFreshness(KEY, { fetchedAt: 1, source: 'dexie' });
    const listener = vi.fn();
    subscribeFreshness(listener);

    clearFreshness();

    expect(getFreshness(KEY)).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clearFreshness on an already-empty map notifies nobody', () => {
    const listener = vi.fn();
    subscribeFreshness(listener);

    clearFreshness();

    expect(listener).not.toHaveBeenCalled();
  });
});
