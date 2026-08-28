import { ApiError } from '../api/errors';

/**
 * Shared retry predicate for `@biddaloy/ui`'s query/mutation hooks. A
 * 4xx response means the request was rejected for a reason retrying
 * can't fix — bad input, a role the caller doesn't hold, a resource that
 * doesn't exist, a duplicate — so retrying just repeats the exact same
 * rejection a few times before giving up, adding latency without ever
 * changing the outcome. Anything else (a dropped connection, a 5xx, a
 * timeout) is worth a couple of retries, since those often do resolve on
 * their own.
 *
 * Pass this as the `retry` option on both `useQuery` and `useMutation` —
 * TanStack Query calls it with `(failureCount, error)` for either.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  // [8.12.3]: when the browser says outright that there is no network,
  // the two retries below only spend ~3s of exponential backoff arriving
  // at the same failure — and on a query wrapped by
  // `offlineCachedQueryFn` that is 3s the user spends staring at a
  // spinner before the cached copy they could have had immediately.
  // Only `false` is trusted here; `navigator.onLine === true` proves
  // nothing (see `use-online.ts`), so it changes nothing.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500) {
    return false;
  }
  return failureCount < 2;
}
