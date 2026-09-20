// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAuthState, setActiveTenant } from '../api/auth-state';

import { useRecentItems, type RecentItem } from './recent-items';

const ITEM_A: RecentItem = {
  id: 'students:s1',
  groupId: 'students',
  resultId: 's1',
  label: 'Ahmed Khan',
};
const ITEM_B: RecentItem = {
  id: 'students:s2',
  groupId: 'students',
  resultId: 's2',
  label: 'Fatima Begum',
};

describe('useRecentItems', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearAuthState();
  });

  afterEach(() => {
    clearAuthState();
  });

  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useRecentItems());
    expect(result.current.recentItems).toEqual([]);
  });

  it('adds an item to the front', () => {
    const { result } = renderHook(() => useRecentItems());
    act(() => result.current.addRecentItem(ITEM_A));
    expect(result.current.recentItems).toEqual([ITEM_A]);
  });

  it('moves a duplicate to the front instead of adding a second entry', () => {
    const { result } = renderHook(() => useRecentItems());
    act(() => result.current.addRecentItem(ITEM_A));
    act(() => result.current.addRecentItem(ITEM_B));
    act(() => result.current.addRecentItem(ITEM_A));
    expect(result.current.recentItems).toEqual([ITEM_A, ITEM_B]);
  });

  it('caps the ring buffer at 8 items', () => {
    const { result } = renderHook(() => useRecentItems());
    for (let index = 0; index < 10; index += 1) {
      const item: RecentItem = {
        id: `students:s${index}`,
        groupId: 'students',
        resultId: `s${index}`,
        label: `Student ${index}`,
      };
      act(() => result.current.addRecentItem(item));
    }
    expect(result.current.recentItems).toHaveLength(8);
    expect(result.current.recentItems[0]?.resultId).toBe('s9');
  });

  it('persists across remounts via localStorage', () => {
    const { result, unmount } = renderHook(() => useRecentItems());
    act(() => result.current.addRecentItem(ITEM_A));
    unmount();

    const { result: second } = renderHook(() => useRecentItems());
    expect(second.current.recentItems).toEqual([ITEM_A]);
  });

  it('degrades to empty when localStorage read throws', () => {
    const getItemSpy = vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    const { result } = renderHook(() => useRecentItems());
    expect(result.current.recentItems).toEqual([]);

    getItemSpy.mockRestore();
  });

  it("never writes the outgoing tenant's items into the new tenant's storage slot on a switch", () => {
    // Regression for a real bug: a ref-tracked key paired with a sibling
    // `items` state let the write effect see an already-updated key next
    // to still-stale items in the *same* commit — a transient bad
    // `setItem` call that a follow-up render then silently overwrites
    // with the correct value. Checking only the final localStorage state
    // (or the hook's final `recentItems`) doesn't catch this — both settle
    // correctly either way once React finishes flushing. Spying on every
    // `setItem` call and inspecting the full history is what actually
    // proves the bad intermediate write never happened, not just that its
    // aftermath got cleaned up.
    const tenantBKey = 'command-palette:recent-items:v1:tenant-b:anon';
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem');

    act(() => setActiveTenant('tenant-a'));
    const { result, rerender } = renderHook(() => useRecentItems());
    act(() => result.current.addRecentItem(ITEM_A));
    expect(result.current.recentItems).toEqual([ITEM_A]);

    act(() => {
      setActiveTenant('tenant-b');
      rerender();
    });

    const badWrites = setItemSpy.mock.calls.filter(
      ([storedKey, value]) =>
        storedKey === tenantBKey && typeof value === 'string' && value.includes(ITEM_A.id),
    );
    expect(badWrites).toEqual([]);
    expect(result.current.recentItems).toEqual([]);

    setItemSpy.mockRestore();
  });

  it('degrades silently when localStorage write throws', () => {
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    const { result } = renderHook(() => useRecentItems());
    expect(() => act(() => result.current.addRecentItem(ITEM_A))).not.toThrow();
    expect(result.current.recentItems).toEqual([ITEM_A]);

    setItemSpy.mockRestore();
  });
});
