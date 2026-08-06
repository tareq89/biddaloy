import { ApiError } from '../api/errors';

/**
 * Shared retry predicate for `@beton-boi/ui`'s query/mutation hooks. A
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
  if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500) {
    return false;
  }
  return failureCount < 2;
}
