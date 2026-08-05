/**
 * The one provider stack every component test needs. Currently just
 * TanStack Query (a fresh, retry-disabled QueryClient per call) plus the
 * existing tenant/role/token state from `ui/src/api/auth-state.ts`.
 *
 * Deliberately does **not** wrap a router or i18n provider yet — neither
 * exists in this repo: TanStack Router lands in [8.9.1], TanStack Query's
 * *app* defaults (as opposed to this file's test-only defaults) in [8.9.2],
 * i18next in [8.7.1]. Adding `initialRoute`/`locale` options now would mean
 * either installing that infrastructure ahead of its own dedicated ticket,
 * or shipping options that silently do nothing — both worse than being
 * explicit that they're not here yet. `RenderWithProvidersOptions` is
 * structured so adding them later is additive (new optional fields, a
 * `Wrapper` that grows another layer), not a breaking change to this
 * function's signature.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { afterEach } from 'vitest';

import { clearAuthState, setAccessToken, setActiveRole, setActiveTenant } from '../api/auth-state';

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
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient;
  user: ReturnType<typeof userEvent.setup>;
}

/** A QueryClient configured for tests: retries off (a failing query should
 * surface immediately, not after exponential backoff — the single biggest
 * source of tests that "just take a while" for no visible reason), and
 * `gcTime: Infinity` so a test's seeded/fetched data doesn't get garbage
 * collected mid-test on a fast machine. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
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
 * Auth/tenant/role state is deliberately the exception to "fresh every
 * call": `auth-state.ts` is a module-scoped singleton (see its own
 * comment), not per-instance state, so it can't be reset just by creating
 * something new here. This module registers a global `afterEach` that
 * clears it, so state set by `tenantId`/`role`/`accessToken` in one test
 * never bleeds into the next regardless of which file runs after it. */
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
    ...renderOptions
  } = options;

  if (tenantId !== undefined) setActiveTenant(tenantId);
  if (role !== undefined) setActiveRole(role);
  if (accessToken !== undefined) setAccessToken(accessToken);

  for (const { queryKey, data } of seedQueries) {
    queryClient.setQueryData(queryKey, data);
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const view = render(ui, { wrapper: Wrapper, ...renderOptions });

  return {
    ...view,
    queryClient,
    user: userEvent.setup(),
  };
}

afterEach(() => {
  clearAuthState();
});

export { userEvent };
