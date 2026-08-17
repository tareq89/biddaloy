import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { toast } from '../components/toast';
import { shouldRetryQuery } from '../hooks/retry';
import { i18n, COMMON_NAMESPACE } from '../i18n';

import { ApiError } from './errors';

/**
 * [8.9.2]'s "global error handling routes 401 to the refresh flow and 403
 * to a permission message" — the 401 half needs nothing here: every
 * `apiClient` request already transparently retries once behind a silent
 * token refresh (`api/client.ts`'s response interceptor), so a query only
 * ever sees a 401 after that refresh has already failed, at which point
 * `notifySessionExpired()` (also in `api/client.ts`) has already fired.
 * The 403 half is what's new — nothing showed the user anything before
 * this, so a permission failure anywhere in the app just looked like a
 * silently broken button. `QueryCache`/`MutationCache`'s shared `onError`
 * is what makes this "global": every query and mutation gets it for free,
 * not just ones whose component remembered to check `error.statusCode`.
 *
 * `i18n.t()` directly, not `useTranslation()` — this runs from
 * `QueryCache`'s own callback, outside any component's render.
 */
function handleGlobalQueryError(error: unknown): void {
  if (error instanceof ApiError && error.statusCode === 403) {
    toast.error(i18n.t('errors.permissionDenied', { ns: COMMON_NAMESPACE }));
  }
}

/**
 * The one `QueryClient` every real app entry point should construct —
 * `client-admin`'s `main.tsx` is the reference caller. Not used by tests:
 * `ui/src/test/render-with-providers.tsx`'s `createTestQueryClient()` is a
 * deliberately different, retry-disabled client tuned for fast, isolated
 * test failures instead of cached-first rendering — see that function's
 * own doc comment.
 *
 * - `staleTime: 30s` — cached-first rendering's whole point is that a
 *   remount or a tab refocus shows last-known data instantly rather than
 *   a spinner; a page revisited within 30s of its last fetch shouldn't
 *   refetch just because a new component instance mounted. Data that
 *   genuinely needs to be fresher than that (a payment status being
 *   polled, say) overrides `staleTime` on that one query, not here.
 * - `gcTime: 5 minutes` — TanStack's own default, kept explicit rather
 *   than left implicit so the pairing with `staleTime` reads as one
 *   deliberate decision, not one tuned value next to an accidental one.
 * - `retry: shouldRetryQuery` (`hooks/retry.ts`) as the client-level
 *   default — every entity hook already passes this explicitly too (see
 *   `ui/README.md`'s "Hooks" section for why that stays explicit rather
 *   than being removed now that a default exists: it's what lets a test's
 *   own `QueryClient` override the test client's `retry: false` on a
 *   single query). Setting it here as well is what makes "excludes 4xx"
 *   true for a future hook that forgets to pass it, not just the ones
 *   that remember.
 * - `refetchOnWindowFocus`/`refetchOnReconnect` are left at TanStack's own
 *   default (`true`) rather than set here — that default *is* the
 *   "background revalidation" half of cached-first rendering (§6): tabbing
 *   back in or a connection coming back can silently refetch stale data
 *   behind whatever's already on screen, no spinner needed unless the
 *   result actually changed. This is the exact pair of options
 *   `createTestQueryClient()` turns off, for the opposite reason — a test
 *   has no tab to refocus and no flaky connection to reconnect, so both
 *   would only add nondeterminism there.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
      },
      mutations: {
        retry: shouldRetryQuery,
      },
    },
    queryCache: new QueryCache({ onError: handleGlobalQueryError }),
    mutationCache: new MutationCache({ onError: handleGlobalQueryError }),
  });
}
