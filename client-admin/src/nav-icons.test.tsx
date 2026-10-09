import { describe, expect, it } from 'vitest';

import { MORE_ICON, PLATFORM_NAV_ICONS, PORTAL_NAV_ICONS, STAFF_NAV_ICONS } from './nav-icons';
import { STAFF_NAV_ITEMS } from './nav-tree';

describe('nav icons [31.3.1]', () => {
  it('every staff nav id has an icon', () => {
    for (const id of Object.keys(STAFF_NAV_ITEMS)) {
      expect(STAFF_NAV_ICONS[id as keyof typeof STAFF_NAV_ICONS], id).toBeDefined();
    }
  });

  it('staff icons plus the two platform extras are all different', () => {
    const all = [...Object.values(STAFF_NAV_ICONS), ...Object.values(PLATFORM_NAV_ICONS)];
    expect(all).toHaveLength(Object.keys(STAFF_NAV_ITEMS).length + 2);
    expect(new Set(all).size).toBe(all.length);
  });

  it('portal icons are all different', () => {
    const icons = Object.values(PORTAL_NAV_ICONS);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('no staff or portal icon is the More icon', () => {
    const all = [...Object.values(STAFF_NAV_ICONS), ...Object.values(PORTAL_NAV_ICONS)];
    expect(all).not.toContain(MORE_ICON);
  });
});
