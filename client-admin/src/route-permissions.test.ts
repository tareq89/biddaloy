import { Permission } from '@biddaloy/shared';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { STAFF_NAV_GROUPS, STAFF_NAV_ITEMS } from './nav-tree';
import { STAFF_ROUTE_PERMISSIONS } from './route-permissions';
import { routeTree } from './routeTree.gen';

/**
 * [8.14.17] Drift guard, copying `route-manifest.test.ts`'s technique
 * (`router.routesById`, a throwaway `QueryClient` context, leaf routes
 * only). `STAFF_ROUTE_PERMISSIONS` must cover exactly the leaf routes
 * under `/_staff` — a typo'd key would otherwise mean "no permission
 * required", the exact bug class [8.14.17] exists to close.
 */
const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

function staffLeafRouteIds(): string[] {
  const routes = Object.values(router.routesById) as { id: string; children?: unknown[] }[];
  return routes
    .filter(
      (route) =>
        route.id.startsWith('/_staff/') && (!route.children || route.children.length === 0),
    )
    .map((route) => route.id);
}

describe('STAFF_ROUTE_PERMISSIONS', () => {
  it('has exactly one entry per leaf route under /_staff — no missing, no stale', () => {
    const actual = [...new Set(staffLeafRouteIds())].sort();
    const mapped = Object.keys(STAFF_ROUTE_PERMISSIONS).sort();

    const missing = actual.filter((id) => !mapped.includes(id));
    const stale = mapped.filter((id) => !actual.includes(id));

    expect(
      missing,
      `route(s) missing a STAFF_ROUTE_PERMISSIONS entry: ${missing.join(', ')}`,
    ).toEqual([]);
    expect(
      stale,
      `stale STAFF_ROUTE_PERMISSIONS entry(ies) for route(s) that no longer exist: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('maps every route to a real Permission value', () => {
    const validPermissions = new Set(Object.values(Permission));
    for (const [routeId, permission] of Object.entries(STAFF_ROUTE_PERMISSIONS)) {
      expect(validPermissions.has(permission), `${routeId} -> ${String(permission)}`).toBe(true);
    }
  });
});

/**
 * `nav-tree.ts`'s `STAFF_NAV_GROUPS`/`STAFF_NAV_ITEMS` each carry their own
 * `permission` — the gate that decides whether the item is *shown* in
 * `_staff.tsx`'s sidebar. This cross-checks that gate against
 * `STAFF_ROUTE_PERMISSIONS`, the gate that decides whether the route
 * itself *renders*: a nav item and its target route disagreeing about
 * which permission is required is exactly the kind of drift `_staff.tsx`'s
 * own file comment promises can't happen (Sidebar and BottomNav share one
 * item object; this extends the same promise to the route guard).
 *
 * Reads `nav-tree.ts`'s plain data directly, not a render — `StaffLayout`
 * needs `RegionConfigProvider`/router/query-client context to mount, and
 * `_staff.access.test.tsx` already exercises the real rendered gate
 * end-to-end. [30.1.3] made `nav-tree.ts` importable from a plain
 * `.test.ts` for exactly this reason, so this test no longer needs to
 * regex `_staff.tsx`'s source text for the `{ to, permission }` shape.
 */
/** Nav `to` paths (URL paths, no `/_staff` prefix) to the route ID
 * `STAFF_ROUTE_PERMISSIONS` keys them under. Index leaves carry a
 * trailing slash — see `routeTree.gen.ts`. */
const NAV_PATH_TO_ROUTE_ID: Record<string, string> = {
  '/dashboard': '/_staff/dashboard',
  '/students': '/_staff/students/',
  '/attendance': '/_staff/attendance/',
  '/attendance/reports': '/_staff/attendance/reports',
  '/attendance/register': '/_staff/attendance/register',
  '/fees/dues': '/_staff/fees/dues',
  '/payments/record': '/_staff/payments/record',
  '/guardians': '/_staff/guardians/',
  '/calendar': '/_staff/calendar/',
  '/staff': '/_staff/staff/',
  '/fees': '/_staff/fees/',
  '/fee-structures': '/_staff/fee-structures/',
  '/fees/generate': '/_staff/fees/generate',
  '/fees/schedules': '/_staff/fees/schedules/',
  '/invoices': '/_staff/invoices/',
  '/communications/send': '/_staff/communications/send',
  '/communications/reminders': '/_staff/communications/reminders',
  '/communications/batches': '/_staff/communications/batches/',
  '/academic-years': '/_staff/academic-years/',
  '/classes': '/_staff/classes/',
  '/exams': '/_staff/exams/',
  '/analysis': '/_staff/analysis/',
  '/grading-scales': '/_staff/grading-scales/',
  '/routines/setup': '/_staff/routines/setup',
  '/routines': '/_staff/routines/',
  '/audit-logs': '/_staff/audit-logs/',
  '/settings': '/_staff/settings',
  '/reports/collections': '/_staff/reports/collections',
};

/** Every `to`/`permission` pair `STAFF_NAV_GROUPS` declares (plus
 * `dashboard`, `_staff.tsx`'s one flat `navItems` entry outside any
 * group), flattened — `nav-tree.ts` is plain data, so this just walks it
 * directly rather than regexing `_staff.tsx`'s rendered JSX for the
 * shape. */
function collectNavPermissions(): Map<string, string> {
  const found = new Map<string, string>();
  if (STAFF_NAV_ITEMS.dashboard.permission !== undefined) {
    found.set(STAFF_NAV_ITEMS.dashboard.to, STAFF_NAV_ITEMS.dashboard.permission);
  }
  for (const group of STAFF_NAV_GROUPS) {
    for (const item of [...(group.pinnedItems ?? []), ...group.items]) {
      if (item.permission !== undefined) found.set(item.to, item.permission);
    }
  }
  return found;
}

describe('nav-tree.ts nav items agree with STAFF_ROUTE_PERMISSIONS', () => {
  const navPermissions = collectNavPermissions();

  it('found every expected nav item in nav-tree.ts (sanity check)', () => {
    expect([...navPermissions.keys()].sort()).toEqual(Object.keys(NAV_PATH_TO_ROUTE_ID).sort());
  });

  it.each(Object.entries(NAV_PATH_TO_ROUTE_ID))(
    'nav item %s requires the same permission as its route',
    (navPath, routeId) => {
      const navPermission = navPermissions.get(navPath);
      expect(navPermission, `no nav item found for ${navPath}`).toBeDefined();
      expect(`Permission.${navPermission}`).toBe(`Permission.${STAFF_ROUTE_PERMISSIONS[routeId]}`);
    },
  );
});
