import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { toast } from '../components/toast';
import { shouldRetryQuery } from '../hooks/retry';
import { i18n, COMMON_NAMESPACE } from '../i18n';

import { ApiError, isTenantSuspendedError } from './errors';

/**
 * Shows a permission-denied toast for any query/mutation that fails with a
 * 403, app-wide — see `ui/README.md`'s "The app's query client" section
 * for why 401 needs no handling here. `i18n.t()` directly, not
 * `useTranslation()`, since this runs outside any component's render.
 *
 * [15.4.2] A suspended tenant's 403 is the one exception: it is not a
 * permission problem with this request, it is the whole school being
 * paused, and `RouteErrorFallback` renders a full-page state for it (see
 * `throwOnError` below). A "permission denied" toast on top of that page
 * would contradict it.
 */
function handleGlobalQueryError(error: unknown): void {
  if (error instanceof ApiError && error.statusCode === 403 && !isTenantSuspendedError(error)) {
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
        // [15.4.2] A suspended school's 403 is rethrown from `useQuery`
        // into the nearest route error boundary, where `RouteErrorFallback`
        // renders its suspended fork. Every page has its own idea of what
        // an inline query error looks like ("Could not load settings" and
        // the like), and none of them can say "your school is paused" —
        // this is the one place that turns a per-query failure into the
        // app-wide state the server is actually reporting.
        throwOnError: isTenantSuspendedError,
      },
      mutations: {
        retry: shouldRetryQuery,
      },
    },
    queryCache: new QueryCache({ onError: handleGlobalQueryError }),
    mutationCache: new MutationCache({ onError: handleGlobalQueryError }),
  });
}
