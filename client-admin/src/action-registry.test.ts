import { Permission } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { ACTIONS } from './action-registry';
import { STAFF_ROUTE_PERMISSIONS } from './route-permissions';

const VALID_KINDS = new Set(['modal', 'navigate', 'inline']);
const PERMISSION_VALUES = new Set(Object.values(Permission));

describe('action-registry.ts', () => {
  it('has at least one seeded action', () => {
    expect(ACTIONS.length).toBeGreaterThan(0);
  });

  it('every id is unique', () => {
    const ids = ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(ACTIONS.map((action) => [action.id, action] as const))(
    '%s: permission is a real Permission enum member',
    (_id, action) => {
      expect(PERMISSION_VALUES.has(action.permission)).toBe(true);
    },
  );

  it.each(ACTIONS.map((action) => [action.id, action] as const))(
    '%s: has both en and bn labels',
    (_id, action) => {
      expect(action.label.en.length).toBeGreaterThan(0);
      expect(action.label.bn.length).toBeGreaterThan(0);
    },
  );

  it.each(ACTIONS.map((action) => [action.id, action] as const))(
    '%s: kind is one of modal | navigate | inline',
    (_id, action) => {
      expect(VALID_KINDS.has(action.kind)).toBe(true);
    },
  );

  it.each(ACTIONS.map((action) => [action.id, action] as const))(
    '%s: run() calls navigate without throwing',
    (_id, action) => {
      const calls: string[] = [];
      expect(() => action.run({ navigate: (opts) => calls.push(opts.to) })).not.toThrow();
      expect(calls.length).toBe(1);
    },
  );

  it('every seeded action targets a route that exists in STAFF_ROUTE_PERMISSIONS with the same permission', () => {
    for (const action of ACTIONS) {
      const calls: string[] = [];
      action.run({ navigate: (opts) => calls.push(opts.to) });
      const [target] = calls;
      const routePermission =
        STAFF_ROUTE_PERMISSIONS[target as keyof typeof STAFF_ROUTE_PERMISSIONS];
      expect(
        routePermission,
        `no STAFF_ROUTE_PERMISSIONS entry for ${target} (action ${action.id})`,
      ).toBeDefined();
      expect(
        action.permission,
        `${action.id} permission (${action.permission}) does not match route ${target}'s permission (${routePermission})`,
      ).toBe(routePermission);
    }
  });
});
