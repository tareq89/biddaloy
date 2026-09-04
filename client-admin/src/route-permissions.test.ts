import { Permission } from '@biddaloy/shared';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

// Vite's `?raw` suffix imports the file's contents as a plain string at
// build/test time — no `node:fs`/`node:url` needed, and no ESM
// `import.meta.url` file-scheme assumption that doesn't hold under
// Vitest's module transform.
import { STAFF_ROUTE_PERMISSIONS } from './route-permissions';
import staffTsxSource from './routes/_staff.tsx?raw';
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
 * `_staff.tsx`'s sidebar nav items each carry their own `permission` —
 * the gate that decides whether the item is *shown*. This cross-checks
 * that gate against `STAFF_ROUTE_PERMISSIONS`, the gate that decides
 * whether the route itself *renders*: a nav item and its target route
 * disagreeing about which permission is required is exactly the kind of
 * drift `_staff.tsx`'s own file comment promises can't happen (Sidebar
 * and BottomNav share one item object; this extends the same promise to
 * the route guard).
 *
 * Regex over the source text, not a render — `StaffLayout` needs
 * `RegionConfigProvider`/router/query-client context to mount, and
 * `_staff.access.test.tsx` already exercises the real rendered gate
 * end-to-end. This test only needs the static `{ to: '...', permission:
 * Permission.XXX }` shape every nav item object shares.
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
  '/staff': '/_staff/staff/',
  '/fees': '/_staff/fees/',
  '/fee-structures': '/_staff/fee-structures/',
  '/fees/generate': '/_staff/fees/generate',
  '/invoices': '/_staff/invoices/',
  '/communications/send': '/_staff/communications/send',
  '/communications/reminders': '/_staff/communications/reminders',
  '/communications/batches': '/_staff/communications/batches/',
  '/academic-years': '/_staff/academic-years/',
  '/classes': '/_staff/classes/',
  '/audit-logs': '/_staff/audit-logs/',
  '/settings': '/_staff/settings',
};

/** Matches each nav item object's `to`/`permission` pair, in either
 * order — `_staff.tsx` always writes `to` before `permission`, but the
 * regex doesn't assume it so a harmless reorder doesn't silently stop
 * this test from finding the pair. */
function extractNavPermissions(source: string): Map<string, string> {
  const itemPattern = /to:\s*'([^']+)'[\s\S]{0,200}?permission:\s*Permission\.(\w+)/g;
  const found = new Map<string, string>();
  for (const match of source.matchAll(itemPattern)) {
    const [, to, permission] = match;
    if (to && permission) found.set(to, permission);
  }
  return found;
}

describe('_staff.tsx nav items agree with STAFF_ROUTE_PERMISSIONS', () => {
  const navPermissions = extractNavPermissions(staffTsxSource);

  it('found every expected nav item in _staff.tsx (regex sanity check)', () => {
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
