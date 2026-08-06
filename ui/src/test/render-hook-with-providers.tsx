/**
 * `renderWithProviders`'s counterpart for hooks — same provider stack,
 * same options, `renderHook` instead of `render`. Kept as a thin sibling
 * rather than folding into `renderWithProviders` itself: a hook has no
 * markup to render, and RTL's `renderHook`/`render` have different result
 * shapes (`result.current` + `rerender(newProps)` vs. queries).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, type RenderHookOptions, type RenderHookResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { setAccessToken, setActiveRole, setActiveTenant } from '../api/auth-state';

import { createTestQueryClient } from './render-with-providers';
import type { SeedQuery } from './render-with-providers';

export interface RenderHookWithProvidersOptions<Props> extends Omit<
  RenderHookOptions<Props>,
  'wrapper'
> {
  /** Active tenant for this render — see `auth-state.ts`'s `setActiveTenant`. */
  tenantId?: string;
  /** Active role for this render — see `auth-state.ts`'s `setActiveRole`. */
  role?: string;
  /** Access token for this render — see `auth-state.ts`'s `setAccessToken`. */
  accessToken?: string;
  /** Supply your own QueryClient instead of the fresh one this creates by
   * default. */
  queryClient?: QueryClient;
  /** Pre-populate the QueryClient's cache before the first render. */
  seedQueries?: SeedQuery[];
}

export interface RenderHookWithProvidersResult<Result, Props> extends RenderHookResult<
  Result,
  Props
> {
  queryClient: QueryClient;
}

/** Renders `callback` (a hook) wrapped in the same provider stack
 * `renderWithProviders` gives components, with the same options
 * (`tenantId`/`role`/`accessToken`, `seedQueries`, a caller-supplied
 * `queryClient`) and the same per-call-fresh-QueryClient default. Call
 * `cleanupTestState()` between tests exactly like `renderWithProviders` —
 * `ui/src/test/setup.ts` already does this globally, nothing extra needed
 * here.
 *
 * `initialProps`/`rerender(newProps)` are RTL's own `renderHook` options —
 * passed straight through via `...renderHookOptions`, for hooks that react
 * to their argument changing between renders. */
export function renderHookWithProviders<Result, Props>(
  callback: (props: Props) => Result,
  options: RenderHookWithProvidersOptions<Props> = {},
): RenderHookWithProvidersResult<Result, Props> {
  const {
    tenantId,
    role,
    accessToken,
    queryClient = createTestQueryClient(),
    seedQueries = [],
    ...renderHookOptions
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

  const view = renderHook(callback, { wrapper: Wrapper, ...renderHookOptions });

  return {
    ...view,
    queryClient,
  };
}
