import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import { setAccessToken, setActiveRole, setActiveTenant } from '../api/auth-state';

import { createTestQueryClient } from './render-with-providers';

export interface RenderWithRouterOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Where in the in-memory history stack to mount — `['/students?page=2']`
   * is how a test "mounts at an arbitrary URL with search params" without
   * a real browser or `BrowserRouter`. */
  initialEntries?: string[];
  /** Which entry in `initialEntries` is "current" — lets a test seed
   * history *before* the entry under test, so `router.navigate(-1)` has
   * something real to go back to. */
  initialIndex?: number;
  tenantId?: string;
  role?: string;
  accessToken?: string;
  queryClient?: QueryClient;
}

export interface RenderWithRouterResult extends RenderResult {
  queryClient: QueryClient;
  /** The live `react-router` data router — read `router.state.location`
   * for URL assertions, call `router.navigate(-1)` for back-navigation
   * (an in-memory router has no real browser history to drive this
   * through `window.history.back()`). */
  router: ReturnType<typeof createMemoryRouter>;
}

/**
 * `renderWithProviders`'s router-aware sibling — see `ui/README.md`'s
 * Testing section for why this is a separate function rather than an
 * option grafted onto `renderWithProviders` itself: that function's own
 * doc comment already promises a `RouterProvider` layer arrives with
 * [8.9.1], and this harness is deliberately scoped to [8.4.5]'s
 * integration tests, not a preview of that ticket's eventual API.
 *
 * Takes a `RouteObject[]` (react-router's own route-config shape) rather
 * than a single element, so a test can exercise real route matching —
 * nested routes, a `RequireRole` guard redirecting to a sibling route,
 * `loader`/`action` if a later ticket adds them — not just render one
 * component in isolation.
 */
export function renderWithRouter(
  routes: RouteObject[],
  options: RenderWithRouterOptions = {},
): RenderWithRouterResult {
  const {
    initialEntries = ['/'],
    initialIndex,
    tenantId,
    role,
    accessToken,
    queryClient = createTestQueryClient(),
    ...renderOptions
  } = options;

  if (tenantId !== undefined) setActiveTenant(tenantId);
  if (role !== undefined) setActiveRole(role);
  if (accessToken !== undefined) setAccessToken(accessToken);

  const router = createMemoryRouter(routes, {
    initialEntries,
    ...(initialIndex !== undefined ? { initialIndex } : {}),
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
    renderOptions,
  );

  return { ...view, queryClient, router };
}
