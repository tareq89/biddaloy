import { Permission } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import bn from '../../../../../../ui/src/i18n/locales/bn/staff.json';
import en from '../../../../../../ui/src/i18n/locales/en/staff.json';

import { PERMISSION_GROUPS } from './permission-groups';

describe('PERMISSION_GROUPS', () => {
  it('puts every Permission in exactly one group', () => {
    const all = PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect([...all].sort()).toEqual(Object.values(Permission).sort());
  });

  it('has unique group ids', () => {
    const ids = PERMISSION_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([
    ['en', en],
    ['bn', bn],
  ])('has %s labels for every group and permission', (_locale, json) => {
    const { groups, items } = json.permissions as {
      groups: Record<string, string>;
      items: Record<string, string>;
    };
    for (const g of PERMISSION_GROUPS) {
      expect(groups[g.id], g.id).toBeTruthy();
      for (const p of g.permissions) expect(items[p], p).toBeTruthy();
    }
  });
});
