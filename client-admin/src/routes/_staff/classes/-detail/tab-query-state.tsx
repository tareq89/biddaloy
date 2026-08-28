import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, SkeletonTable } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { UseQueryResult } from '@tanstack/react-query';

export interface TabQueryStateProps<T> {
  query: UseQueryResult<T, unknown>;
  forbiddenMessage: string;
  errorMessage: string;
  /** What to show while the query is pending. Defaults to a shape that
   * matches what this route's tabs actually render — all three of them
   * are a `Table` —
   * so the tab does not jump when the data lands. The CLS ≤ 0.1 budget is
   * the reason this is shaped at all rather than three generic bars
   * ([8.13.11]); a tab whose content is a different shape passes its own. */
  skeleton?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}

/**
 * The loading/error/forbidden boilerplate this route's detail tabs share
 * — own local copy, not promoted to `@biddaloy/ui`, same reasoning as
 * `academic-years/-detail/tab-query-state.tsx` and
 * `students/-detail/tab-query-state.tsx`'s identical copies: it's still
 * just a thin composition over that package's `Skeleton`/`ErrorState`.
 */
export function TabQueryState<T>({
  query,
  forbiddenMessage,
  errorMessage,
  skeleton = <SkeletonTable rows={4} columns={4} />,
  children,
}: TabQueryStateProps<T>) {
  const { t } = useTranslation('common');

  if (query.isPending) {
    return <>{skeleton}</>;
  }

  if (query.isError) {
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
