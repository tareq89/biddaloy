import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { toast } from '../components/toast';
import { shouldRetryQuery } from '../hooks/retry';
import { i18n, COMMON_NAMESPACE } from '../i18n';

import { ApiError } from './errors';

/**
 * Shows a permission-denied toast for any query/mutation that fails with a
 * 403, app-wide — see `ui/README.md`'s "The app's query client" section
 * for why 401 needs no handling here. `i18n.t()` directly, not
 * `useTranslation()`, since this runs outside any component's render.
 */
function handleGlobalQueryError(error: unknown): void {
  if (error instanceof ApiError && error.statusCode === 403) {
    toast.error(i18n.t('errors.permissionDenied', { ns: COMMON_NAMESPACE }));
  }
}

/**
 * The one `QueryClient` every real app entry point should construct —
 * `client-admin`'s `main.tsx` is the reference caller. Tuned for
 * cache-first rendering with background revalidation; see `ui/README.md`'s
 * "The app's query client" section for what each option does and how it
 * compares to `createTestQueryClient()` (`ui/src/test/
 * render-with-providers.tsx`), the deliberately different client tests use.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
        // [8.12.6]: `offlineFirst`, not TanStack Query's default
        // `online`. Under `online`, a query with no cached data does not
        // run at all while `navigator.onLine` is false — it goes to
        // `paused` and its promise never settles. For a route whose
        // `loader` awaits `ensureQueryData`, that means an offline
        // navigation hangs on the previous screen forever: no data, no
        // error, no offline state, nothing to retry.
        //
        // It also made the whole offline read path unreachable in exactly
        // the case it was built for. Both fallbacks live *inside* the
        // query function — the service worker's `api-cache`
        // (`client-admin/src/sw.ts`) and the Dexie read cache
        // (`offlineCachedQueryFn`) — and a paused query never calls its
        // query function, so neither could ever answer.
        //
        // `offlineFirst` lets the fetch run once regardless of what the
        // browser believes about connectivity; the SW answers from cache
        // if it can, and `offlineCachedQueryFn` falls back to Dexie if it
        // cannot. A genuine failure then surfaces as an error the route
        // boundary renders as the offline state. `shouldRetryQuery`
        // already declines to retry while offline, so this costs one
        // attempt, not a retry storm.
        networkMode: 'offlineFirst',
      },
      mutations: {
        retry: shouldRetryQuery,
      },
    },
    queryCache: new QueryCache({ onError: handleGlobalQueryError }),
    mutationCache: new MutationCache({ onError: handleGlobalQueryError }),
  });
}
