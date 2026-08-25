import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import manifest from '../../e2e/route-manifest.json';

import { routeTree } from './routeTree.gen';

/**
 * [8.5.3] Drift guard: `e2e/route-manifest.json` must list exactly the
 * navigable (leaf) routes in the generated route tree. Adding a route
 * without listing it — or leaving a deleted route in the manifest —
 * fails here, next to the code being changed, instead of silently
 * shrinking E2E coverage.
 */

// `context` is required because routes' loaders read `context.queryClient`
// (see `__root.tsx`'s `RouterContext`). This router is only ever used for its
// static `routesById` map below — it never navigates or runs a loader — so a
// throwaway `QueryClient` is enough to satisfy the type.
const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

/** TanStack writes index routes as `/students/` — the manifest uses the
 * canonical no-trailing-slash form. */
function normalize(fullPath: string): string {
  return fullPath !== '/' && fullPath.endsWith('/') ? fullPath.slice(0, -1) : fullPath;
}

/** Leaf routes only — layout routes (`_staff`, `/fees` shell, `/portal`
 * shell) exist to wrap children, not to be navigated to directly. */
function leafPaths(): string[] {
  const routes = Object.values(router.routesById) as {
    fullPath: string;
    children?: unknown[];
  }[];
  return routes
    .filter((route) => !route.children || route.children.length === 0)
    .map((route) => normalize(route.fullPath));
}

describe('e2e route manifest', () => {
  it('lists exactly the leaf routes of routeTree.gen.ts', () => {
    const actual = [...new Set(leafPaths())].sort();
    const listed = manifest.routes.map((r) => r.path).sort();
    expect(listed).toEqual(actual);
  });

  it('gives every dynamic route its params', () => {
    for (const route of manifest.routes) {
      const paramNames = [...route.path.matchAll(/\$(\w+)/g)].map((m) => m[1]!);
      for (const name of paramNames) {
        expect(
          (route as { params?: Record<string, string> }).params?.[name],
          `${route.path} is missing params.${name}`,
        ).toBeTruthy();
      }
    }
  });
});
