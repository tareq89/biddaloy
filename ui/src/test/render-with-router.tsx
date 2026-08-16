import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRoute,
} from '@tanstack/react-router';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';

import { setAccessToken, setActiveRole, setActiveTenant } from '../api/auth-state';
import { i18n } from '../i18n/i18n';
import { I18nProvider } from '../i18n/locale-provider';

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
  locale?: string;
  queryClient?: QueryClient;
}

export interface RenderWithRouterResult<
  TRouteTree extends AnyRoute = AnyRoute,
> extends RenderResult {
  queryClient: QueryClient;
  /** The live TanStack Router instance — read `router.state.location`
   * for URL assertions, call `router.history.back()` for back-navigation
   * (an in-memory router has no real browser history to drive this
   * through `window.history.back()`). Parameterized by the caller's own
   * route tree (not just `ReturnType<typeof createRouter>`, which
   * `exactOptionalPropertyTypes` rejects as too loose a target for the
   * actual, more specific value `createRouter<TRouteTree>` returns). */
  router: ReturnType<typeof createRouter<TRouteTree>>;
  /** Resolves once the `locale` option (if given) has actually applied —
   * see `renderWithProviders`'s own `localeReady` field for why this is
   * handed back rather than awaited internally. */
  localeReady: Promise<void>;
}

/**
 * `renderWithProviders`'s router-aware sibling — kept separate rather than
 * folded into that function, so the ~95% of tests that don't touch routing
 * stay exactly as simple as they are today: no route tree to build, no
 * `RouterProvider` layer to pay for. `I18nProvider` **is** included here
 * (unlike the pre-[8.9.1] version of this harness) — this now mounts real
 * app routes, and every real page reads translated strings via
 * `useTranslation`, so omitting it would suspend forever or render
 * untranslated keys.
 *
 * Takes a route tree (the same shape `createRouter({ routeTree })` wants —
 * build one with `createRootRoute().addChildren([...])`) rather than a
 * single element, so a test exercises real route matching — nested
 * routes, a `RequireRole` guard redirecting to a sibling route, a
 * `loader` — not just one component in isolation.
 */
export function renderWithRouter<TRouteTree extends AnyRoute>(
  routeTree: TRouteTree,
  options: RenderWithRouterOptions = {},
): RenderWithRouterResult<TRouteTree> {
  const {
    initialEntries = ['/'],
    initialIndex,
    tenantId,
    role,
    accessToken,
    locale,
    queryClient = createTestQueryClient(),
    ...renderOptions
  } = options;

  if (tenantId !== undefined) setActiveTenant(tenantId);
  if (role !== undefined) setActiveRole(role);
  if (accessToken !== undefined) setAccessToken(accessToken);

  const localeReady =
    locale === undefined ? Promise.resolve() : i18n.changeLanguage(locale).then(() => undefined);

  const history = createMemoryHistory({
    initialEntries,
    ...(initialIndex !== undefined ? { initialIndex } : {}),
  });
  // `context: { queryClient }` mirrors how the real app's router is
  // created — any route in the test tree that calls
  // `context.queryClient.ensureQueryData(...)` in its `loader` works the
  // same way it would in production.
  const router = createRouter({ routeTree, history, context: { queryClient } });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>,
    renderOptions,
  );

  return { ...view, queryClient, router, localeReady };
}
