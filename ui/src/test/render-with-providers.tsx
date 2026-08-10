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
import { DEFAULT_LOCALE, clearPersistedLocale, type Locale } from '../i18n/locale-storage';

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
  /** Settles once the `locale` option's language change has finished
   * loading its resources — resolved immediately when no `locale` was
   * passed.
   *
   * `await` this before any *synchronous* assertion about translated
   * content. `changeLanguage()` can't be awaited inside this helper
   * without making it async for the majority of callers that never pass a
   * locale, so the promise is handed back instead. The failure it guards
   * against is quiet rather than loud: if the outgoing language's bundle
   * is already loaded, the first render doesn't suspend at all — it paints
   * the *previous* language, and a `getByText` runs green against the
   * wrong string. `findBy*`/`waitFor` are already safe without this. */
  localeReady: Promise<void>;
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
  // Handed back as `localeReady` rather than awaited here — see that
  // field's own comment for why this helper stays synchronous, and for
  // the quiet wrong-language render that awaiting it prevents.
  const localeReady =
    locale === undefined ? Promise.resolve() : i18n.changeLanguage(locale).then(() => undefined);

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
    localeReady,
  };
}

/** Resets everything `renderWithProviders` can set as global/singleton
 * state — `auth-state.ts`, the shared i18next instance's active language,
 * and the locale that language change persisted (so a `locale: 'en'`
 * render in one test doesn't leak into the next test's default-locale
 * assumptions). A plain function, not a side effect of importing this
 * module: registering a global test hook as an import side effect means
 * anyone who imports `renderWithProviders` implicitly changes the whole
 * test run's lifecycle, which gets worse every time this function grows
 * another thing to reset (MSW, fake timers, mocks, ...).
 * `ui/src/test/setup.ts` is the one place that wires this into
 * `afterEach` — call it from there, not here.
 *
 * Async, and returned rather than fire-and-forget, because `afterEach`
 * awaits a returned promise: a language change left in flight would
 * otherwise settle partway through the *next* test and flip its language
 * mid-run.
 *
 * The reset is unconditional. Guarding it on `i18n.language !==
 * DEFAULT_LOCALE` looked equivalent but wasn't — `i18n.ts` persists on
 * every `languageChanged`, so the stored key and the in-memory language
 * are two separate pieces of state, and anything that moved one without
 * the other (`locale-storage.test.ts` calls `persistLocale` directly)
 * short-circuited the guard and survived into the rest of the worker.
 * A later `createI18nInstance()` then seeds `lng` from that leftover and
 * starts in the wrong language, which is exactly the isolation its own
 * doc comment promises. */
export async function cleanupTestState(): Promise<void> {
  clearAuthState();
  await i18n.changeLanguage(DEFAULT_LOCALE);
  clearPersistedLocale();
}

export { userEvent };
