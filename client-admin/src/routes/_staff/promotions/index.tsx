/**
 * [26.6.1] Promotion runs list. Same `ListShell` shape as
 * `exams/index.tsx`, minus that route's filter bar and dialogs — the
 * server doesn't paginate `/promotions` (`ui/src/hooks/promotions.ts`), so
 * pagination here is sliced client-side over the full array.
 *
 * See the `## Plan — #1003` GitHub comment for the full design.
 */
import { Button, RoutePending } from '@biddaloy/ui/components';
import {
  promotionRunsQueryOptions,
  useAcademicYears,
  useClasses,
  usePromotionRuns,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';

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
  const [state, actions] = useListShellState({ limit: 10 });

  const runsQuery = usePromotionRuns();
  const classesQuery = useClasses({});
  const yearsQuery = useAcademicYears();

  const classNames = new Map((classesQuery.data?.data ?? []).map((cls) => [cls.id, cls.name]));
  const yearNames = new Map((yearsQuery.data?.data ?? []).map((year) => [year.id, year.name]));

  const runs = runsQuery.data ?? [];
  const totalCount = runs.length;
  const data = runs.slice((state.page - 1) * state.limit, state.page * state.limit);

  return (
    <ListShell
      title={t('list.title')}
      primaryAction={
        <Button asChild>
          <Link to="/promotions/new">{t('list.newRun')}</Link>
        </Button>
      }
      tableId="promotion-runs-list"
      caption={t('list.caption')}
      columns={[
        {
          id: 'sourceTarget',
          header: `${t('list.columnSourceClass')} → ${t('list.columnTargetClass')}`,
          accessorFn: (row) => {
            const sourceName = classNames.get(row.source_class_id) ?? row.source_class_id;
            const targetName =
              row.target_class_id === null
                ? t('outcome.graduate')
                : (classNames.get(row.target_class_id) ?? row.target_class_id);
            return (
              <Link to="/promotions/$runId" params={{ runId: row.id }} className="underline">
                {sourceName} → {targetName}
              </Link>
            );
          },
        },
        {
          id: 'targetYear',
          header: t('list.columnTargetYear'),
          accessorFn: (row) =>
            yearNames.get(row.target_academic_year_id) ?? row.target_academic_year_id,
        },
        {
          id: 'status',
          header: t('list.columnStatus'),
          accessorFn: (row) =>
            t(row.status === 'DRAFT' ? 'list.statusDraft' : 'list.statusCommitted'),
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
          accessorFn: (row) => formatNumber(row.override_count, config),
        },
        {
          id: 'committedAt',
          header: t('list.columnCommittedAt'),
          accessorFn: (row) =>
            row.committed_at ? formatDate(new Date(row.committed_at), config) : '—',
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
      emptyMessage={t('list.empty')}
    />
  );
}

function PromotionsListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
