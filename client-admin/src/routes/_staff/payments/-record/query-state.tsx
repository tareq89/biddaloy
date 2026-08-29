import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

export interface QueryStateProps<T> {
  query: UseQueryResult<T, unknown>;
  forbiddenMessage: string;
  errorMessage: string;
  /** What to show while the query is pending. Defaults to the three
   * summary cards `OutstandingFeesStep` renders once the fee summary
   * arrives — same grid, same card height — so the amount field below it
   * does not jump down the screen mid-load ([8.13.11], CLS <= 0.1). */
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
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
  skeleton = <OutstandingFeesSkeleton />,
  children,
}: QueryStateProps<T>) {
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

/**
 * Mirrors `outstanding-fees-step.tsx`'s own summary grid: three cards, one
 * `sm:grid-cols-3` row, each `p-4` around a `text-sm` label and a
 * `text-lg` figure. `h-[5.125rem]` is that sum (16 + 22 + 26 + 16 + 2px of
 * border), so the placeholder occupies exactly the box the real cards take.
 */
function OutstandingFeesSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Skeleton className="h-[5.125rem] rounded-lg" />
      <Skeleton className="h-[5.125rem] rounded-lg" />
      <Skeleton className="h-[5.125rem] rounded-lg" />
    </div>
  );
}
