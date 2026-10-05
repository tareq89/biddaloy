/**
 * [26.6.1] Promotion runs list. Same `ListShell` shape as
 * `exams/index.tsx`, minus that route's filter bar and dialogs — the
 * server doesn't paginate `/promotions` (`ui/src/hooks/promotions.ts`), so
 * pagination here is sliced client-side over the full array.
 *
 * See the `## Plan — #1003` GitHub comment for the full design.
 */
import { RoutePending, Skeleton, StatusBadge } from '@biddaloy/ui/components';
import {
  promotionRunsQueryOptions,
  useAcademicYears,
  useAllClasses,
  usePromotionRuns,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/promotions/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(promotionRunsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('promotions', 'common'),
    ]),
  pendingComponent: PromotionsListPending,
  component: PromotionsListPage,
});

function PromotionsListPage() {
  const { t } = useTranslation('promotions');
  const config = useRegionConfig();
  const navigate = Route.useNavigate();
  const [state, actions] = useListShellState();

  const runsQuery = usePromotionRuns();
  const classesQuery = useAllClasses();
  const yearsQuery = useAcademicYears({ limit: 100 });

  const classNames = new Map((classesQuery.data ?? []).map((cls) => [cls.id, cls.name]));
  const yearNames = new Map((yearsQuery.data?.data ?? []).map((year) => [year.id, year.name]));

  // Never render a raw id: skeleton while the lookup loads, a dash when the id is unknown.
  const nameOr = (names: Map<string, string>, id: string, loading: boolean): ReactNode =>
    names.get(id) ?? (loading ? <Skeleton className="h-4 w-24" /> : t('list.emptyValue'));

  const runs = runsQuery.data ?? [];
  const totalCount = runs.length;
  const data = runs.slice((state.page - 1) * state.limit, state.page * state.limit);
  const goNew = () => void navigate({ to: '/promotions/new' });

  return (
    <ListShell
      title={t('list.title')}
      subtitle={t('list.subtitle')}
      actions={[
        {
          id: 'new',
          label: t('list.newRun'),
          icon: <PlusIcon aria-hidden="true" />,
          priority: 'primary',
          onClick: goNew,
        },
      ]}
      tableId="promotion-runs-list"
      caption={t('list.caption')}
      columns={[
        {
          id: 'sourceTarget',
          header: t('list.columnSourceTarget'),
          card: 'title',
          accessorFn: (row) => (
            <span className="font-medium">
              {nameOr(classNames, row.source_class_id, classesQuery.isLoading)} →{' '}
              {row.target_class_id === null
                ? t('outcome.graduate')
                : nameOr(classNames, row.target_class_id, classesQuery.isLoading)}
            </span>
          ),
        },
        {
          id: 'targetYear',
          header: t('list.columnTargetYear'),
          card: 'subtitle',
          accessorFn: (row) => {
            const year = yearNames.get(row.target_academic_year_id);
            return year === undefined
              ? nameOr(yearNames, row.target_academic_year_id, yearsQuery.isLoading)
              : t('list.cardSubtitle', { year });
          },
        },
        {
          id: 'status',
          header: t('list.columnStatus'),
          card: 'badge',
          accessorFn: (row) => (
            <StatusBadge
              tone={row.status === 'DRAFT' ? 'neutral' : 'success'}
              label={t(row.status === 'DRAFT' ? 'list.statusDraft' : 'list.statusCommitted')}
            />
          ),
        },
        {
          id: 'algorithm',
          header: t('list.columnAlgorithm'),
          accessorFn: (row) =>
            t(
              row.algorithm === 'BLOCK' ? 'newRunForm.algorithmBlock' : 'newRunForm.algorithmSnake',
            ),
        },
        {
          id: 'overrides',
          header: t('list.columnOverrides'),
          align: 'end',
          accessorFn: (row) => formatNumber(row.override_count, config),
        },
        {
          id: 'committedAt',
          header: t('list.columnCommittedAt'),
          accessorFn: (row) =>
            row.committed_at ? formatDate(row.committed_at, config) : t('list.emptyValue'),
        },
      ]}
      rowActions={(row) => [
        {
          intent: 'view',
          label: t('list.view'),
          to: `/promotions/${row.id}`,
          'data-focus-anchor': row.id,
        },
      ]}
      data={data}
      getRowId={(row) => row.id}
      sorting={state.sorting}
      onSortingChange={actions.setSorting}
      page={state.page}
      pageSize={state.limit}
      totalCount={totalCount}
      onPageChange={actions.setPage}
      onPageSizeChange={actions.setLimit}
      pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
      loading={runsQuery.isLoading}
      isFetching={runsQuery.isFetching}
      {...(runsQuery.isError ? { error: t('list.errorMessage') } : {})}
      emptyState={{
        title: t('list.empty'),
        explanation: t('list.emptyExplanation'),
        action: { label: t('list.newRun'), onClick: goNew },
      }}
    />
  );
}

function PromotionsListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
