/**
 * The provider stack every component test needs — TanStack Query and
 * i18next. No router yet; see `ui/README.md`'s "Testing" section for why
 * and what's planned.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';

import { clearAuthState, setAccessToken, setActiveRole, setActiveTenant } from '../api/auth-state';
import { i18n } from '../i18n/i18n';
import { I18nProvider } from '../i18n/locale-provider';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locale-storage';

/** A seeded value for `queryClient.setQueryData` — same key/value shape
 * `useQuery({ queryKey })` reads back, so a test can pre-populate the cache
 * instead of waiting on (or mocking) a real fetch. */
export interface SeedQuery {
  queryKey: readonly unknown[];
  data: unknown;
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Active tenant for this render — see `auth-state.ts`'s `setActiveTenant`. */
  tenantId?: string;
  /** Active role for this render — see `auth-state.ts`'s `setActiveRole`. */
  role?: string;
  /** Access token for this render — see `auth-state.ts`'s `setAccessToken`. */
  accessToken?: string;
  /** Supply your own QueryClient (e.g. to assert on it after interacting
   * with the component) instead of the fresh one this creates by default. */
  queryClient?: QueryClient;
  /** Pre-populate the QueryClient's cache before the first render. */
  seedQueries?: SeedQuery[];
  /** Active locale for this render. i18next is a module-scoped singleton
   * (see the `cleanupTestState` note below), so this — like
   * `tenantId`/`role`/`accessToken` — changes global state rather than
   * something scoped to just this render. Defaults to leaving whatever
   * locale is already active alone. */
  locale?: Locale;
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient;
  user: ReturnType<typeof userEvent.setup>;
}

/** A QueryClient configured for tests: retries off (a failing query should
 * surface immediately, not after exponential backoff — the single biggest
 * source of tests that "just take a while" for no visible reason),
 * `gcTime: Infinity` so seeded/fetched data doesn't get garbage collected
 * mid-test on a fast machine, window-focus/reconnect refetching off so a
 * query only ever fires when the test actually triggers it (jsdom rarely
 * dispatches those events, but "rarely" isn't "never"), and `staleTime:
 * Infinity` so data is never considered stale on its own. That last one
 * matters more than it looks: TanStack Query's default `staleTime: 0`
 * means even `seedQueries`-populated data triggers a background refetch
 * the moment a component mounts and reads it — "seeded" silently didn't
 * mean "no fetch happens" without this. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false },
    },
  });
}

/** Renders `ui` wrapped in the app's provider stack, with sensible test
 * defaults and per-test isolation. Zero-config: `renderWithProviders(<Foo
 * />)` works with no second argument. Each call gets its **own**
 * QueryClient unless one is passed in — the cache never carries over
 * between tests, which is what makes `queries.retry: false` safe: a stale
 * cached error from a previous test can't leak into this one and mask a
 * retry that should have happened.
 *
 * Auth/tenant/role state (`tenantId`/`role`/`accessToken`) is the one
 * exception to "fresh every call" — `auth-state.ts` is a module-scoped
 * singleton (see its own comment), not per-instance state, so it can't be
 * reset just by creating something new here. Call `cleanupTestState()` in
 * an `afterEach` to reset it between tests — `ui/src/test/setup.ts` does
 * this globally for every test file that opts into it via
 * `vitest.config.ts`'s `setupFiles`, so most call sites don't need to
 * think about this at all. */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const {
    tenantId,
    role,
    accessToken,
    queryClient = createTestQueryClient(),
    seedQueries = [],
    locale,
    ...renderOptions
  } = options;

  if (tenantId !== undefined) setActiveTenant(tenantId);
  if (role !== undefined) setActiveRole(role);
  if (accessToken !== undefined) setAccessToken(accessToken);
  // Not awaited, same as `useLocale`'s own `setLocale` — a component under
  // `I18nProvider`'s Suspense boundary that reads translated text
  // suspends until the change (and whatever namespace it pulls in)
  // resolves, so callers don't need to await this themselves.
  if (locale !== undefined) void i18n.changeLanguage(locale);

  for (const { queryKey, data } of seedQueries) {
    queryClient.setQueryData(queryKey, data);
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    );
  }

  const view = render(ui, { wrapper: Wrapper, ...renderOptions });

  return {
    ...view,
    queryClient,
    user: userEvent.setup(),
  };
}

/** Resets everything `renderWithProviders` can set as global/singleton
 * state — `auth-state.ts`, and now the shared i18next instance's active
 * language (so a `locale: 'en'` render in one test doesn't leak into the
 * next test's default-locale assumptions). A plain function, not a side
 * effect of importing this module: registering a global test hook as an
 * import side effect means anyone who imports `renderWithProviders`
 * implicitly changes the whole test run's lifecycle, which gets worse
 * every time this function grows another thing to reset (MSW, fake
 * timers, mocks, localStorage, ...). `ui/src/test/setup.ts` is the one
 * place that wires this into `afterEach` — call it from there, not here. */
export function cleanupTestState(): void {
  clearAuthState();
  if (i18n.language !== DEFAULT_LOCALE) void i18n.changeLanguage(DEFAULT_LOCALE);
}

export { userEvent };
