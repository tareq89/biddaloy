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
      },
      mutations: {
        retry: shouldRetryQuery,
      },
    },
    queryCache: new QueryCache({ onError: handleGlobalQueryError }),
    mutationCache: new MutationCache({ onError: handleGlobalQueryError }),
  });
}
