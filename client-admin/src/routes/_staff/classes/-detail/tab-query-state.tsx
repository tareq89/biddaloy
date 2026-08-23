import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { UseQueryResult } from '@tanstack/react-query';

export interface TabQueryStateProps<T> {
  query: UseQueryResult<T, unknown>;
  forbiddenMessage: string;
  errorMessage: string;
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
  children,
}: TabQueryStateProps<T>) {
  const { t } = useTranslation('common');

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-2/3" />
      </div>
    );
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
