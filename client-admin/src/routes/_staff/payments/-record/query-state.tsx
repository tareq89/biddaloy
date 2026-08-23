import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { UseQueryResult } from '@tanstack/react-query';

export interface QueryStateProps<T> {
  query: UseQueryResult<T, unknown>;
  forbiddenMessage: string;
  errorMessage: string;
  children: (data: T) => React.ReactNode;
}

/**
 * Same loading/error/forbidden boilerplate as `students/-detail/
 * tab-query-state.tsx`'s `TabQueryState`, whose own header comment
 * already anticipated this: "not this route's job to be a reusable
 * primitive yet" — now a second route needs the identical shape. Not
 * importing across the two routes' `-` prefixed (route-private) folders,
 * and not promoting it into `@biddaloy/ui` within this issue's scope
 * either — noted in [8.10.5]'s PR description as worth doing once a
 * third consumer shows up.
 */
export function QueryState<T>({
  query,
  forbiddenMessage,
  errorMessage,
  children,
}: QueryStateProps<T>) {
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
