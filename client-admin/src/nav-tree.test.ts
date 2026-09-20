import { describe, expect, it } from 'vitest';

import { STAFF_NAV_GROUPS, STAFF_NAV_ITEMS } from './nav-tree';

function allGroupItems() {
  return STAFF_NAV_GROUPS.flatMap((group) => [...(group.pinnedItems ?? []), ...group.items]);
}

describe('nav-tree', () => {
  it('every item id is unique', () => {
    const ids = allGroupItems().map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every group id is unique', () => {
    const ids = STAFF_NAV_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no group declares an item whose `to` is empty', () => {
    for (const item of allGroupItems()) {
      expect(item.to).not.toBe('');
    }
  });

  it('keeps the pre-30.1.3 group ids stable so saved collapse preferences survive', () => {
    const ids = STAFF_NAV_GROUPS.map((group) => group.id);
    for (const stable of ['people', 'finance', 'communications', 'administration']) {
      expect(ids).toContain(stable);
    }
  });

  it('is importable and usable with no React render', () => {
    expect(STAFF_NAV_GROUPS.length).toBeGreaterThan(0);
    expect(Object.keys(STAFF_NAV_ITEMS).length).toBeGreaterThan(0);
  });

  it('declares Exams & Results with zero items so it auto-hides until 19.0', () => {
    const examsResults = STAFF_NAV_GROUPS.find((group) => group.id === 'examsResults');
    expect(examsResults?.items).toEqual([]);
    expect(examsResults?.pinnedItems ?? []).toEqual([]);
  });

  it('every item referenced by a group matches its STAFF_NAV_ITEMS entry', () => {
    for (const item of allGroupItems()) {
      expect(STAFF_NAV_ITEMS[item.id as keyof typeof STAFF_NAV_ITEMS]).toBe(item);
    }
  });
});
