// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRecentItems, type RecentItem } from './recent-items';

const ITEM_A: RecentItem = { id: 'students:s1', groupId: 'students', resultId: 's1', label: 'Ahmed Khan' };
const ITEM_B: RecentItem = { id: 'students:s2', groupId: 'students', resultId: 's2', label: 'Fatima Begum' };

describe('useRecentItems', () => {
  beforeEach(() => {
    window.localStorage.clear();
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
    const getItemSpy = vi
      .spyOn(window.localStorage.__proto__, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });

    const { result } = renderHook(() => useRecentItems());
    expect(result.current.recentItems).toEqual([]);

    getItemSpy.mockRestore();
  });

  it('degrades silently when localStorage write throws', () => {
    const setItemSpy = vi
      .spyOn(window.localStorage.__proto__, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });

    const { result } = renderHook(() => useRecentItems());
    expect(() => act(() => result.current.addRecentItem(ITEM_A))).not.toThrow();
    expect(result.current.recentItems).toEqual([ITEM_A]);

    setItemSpy.mockRestore();
  });
});
