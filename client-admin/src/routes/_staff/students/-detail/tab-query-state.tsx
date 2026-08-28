import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, SkeletonTable } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { UseQueryResult } from '@tanstack/react-query';

export interface TabQueryStateProps<T> {
  // `unknown`, not the default `Error` — none of this route's query hooks
  // pin an explicit `TError`, so what `useQuery` actually infers here is
  // `unknown` (axios rejects with `AxiosError`, not always `Error`
  // proper); `axios.isAxiosError` below narrows it either way.
  query: UseQueryResult<T, unknown>;
  /** [8.10.2]'s "PARENT/STUDENT-scoped 403" AC — a tab whose endpoint
   * rejects the current role (a mid-session role change, a stale
   * session) shows this instead of the generic error, and instead of
   * crashing the whole page the way an unhandled rejection would. */
  forbiddenMessage: string;
  errorMessage: string;
  /** What to show while the query is pending. Defaults to a shape that
   * matches what this route's tabs actually render — six of its eight
   * tabs are a `Table` (fees, invoices, payments, guardians, enrolment,
   * activity) —
   * so the tab does not jump when the data lands. The CLS ≤ 0.1 budget is
   * the reason this is shaped at all rather than three generic bars
   * ([8.13.11]); a tab whose content is a different shape passes its own. */
  skeleton?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}

/**
 * The loading/error/forbidden boilerplate every one of the eight detail
 * tabs shares. Not part of `@biddaloy/ui` — it's a thin composition of
 * that package's own `Skeleton`/`ErrorState` over this route's specific
 * "is this a 403" check, not a generally reusable primitive yet.
 */
export function TabQueryState<T>({
  query,
  forbiddenMessage,
  errorMessage,
  skeleton = <SkeletonTable rows={4} columns={5} />,
  children,
}: TabQueryStateProps<T>) {
  const { t } = useTranslation('common');

  if (query.isPending) {
    return <>{skeleton}</>;
  }

  if (query.isError) {
    // `apiClient`'s response interceptor already wraps a failed request
    // into `ApiError` (`ui/src/api/errors.ts`) before it ever reaches a
    // query's error state — not a raw `AxiosError`, so that's what this
    // checks, not `axios.isAxiosError`.
    const forbidden = query.error instanceof ApiError && query.error.statusCode === 403;
    return (
      <ErrorState
        message={forbidden ? forbiddenMessage : errorMessage}
        retryLabel={t('actions.retry')}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return <>{children(query.data)}</>;
}
