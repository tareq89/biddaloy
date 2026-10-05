/**
 * `/fees/schedules/$id` — [16.7.5] detail page: what the rule does (header facts), who is left
 * out (`-exclusions-table.tsx`) and what it has billed so far (a run-history table built from the
 * same columns as `/fees/generate`, with `BatchBillsDrawer` for a round's bills). "Edit" opens the
 * rule form over this page through `?edit=1` (D22).
 */
import { Permission } from '@biddaloy/shared';
import { DataTable, ErrorState, RoutePending, StatusBadge } from '@biddaloy/ui/components';
import {
  recurringScheduleQueryOptions,
  useAcademicYears,
  useFeeGenerations,
  useFeeStructures,
  useHasPermission,
  useRecurringSchedule,
  type FeeGeneration,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useCloseFullPage, useListShellState } from '@biddaloy/ui/shells';
import {
  formatDate,
  formatDateRange,
  formatNumber,
  formatServerAmount,
  parseServerDate,
} from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { PencilIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { BatchBillsDrawer } from '../-generations/batch-bills-drawer';
import { useBatchColumns } from '../-generations/batch-table';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { AudienceCell } from './-audience-cell';
import { ExclusionsTable } from './-exclusions-table';
import { ScheduleFormDialog } from './-schedule-form-dialog';
import { dhakaNow, nextRunDate, ruleSummary } from './-schedule-summary';

const scheduleDetailSearchSchema = z.object({
  edit: z.literal(1).optional().catch(undefined),
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores row selection under — declared so
  // `validateSearch` does not strip it.
  selected: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/fees/schedules/$id')({
  validateSearch: scheduleDetailSearchSchema,
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(recurringScheduleQueryOptions(params.id))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('fees'),
    ]),
  pendingComponent: ScheduleDetailPending,
  component: ScheduleDetailPage,
});

/**
 * Run-history table, scoped to this schedule via `recurring_schedule_id`
 * (added to `QueryFeeGenerationsDto` alongside this fix — #822 review).
 */
function ScheduleRunHistory({ scheduleId }: { scheduleId: string }) {
  const { t } = useTranslation('fees');
  const [state, actions] = useListShellState();
  const columns = useBatchColumns();
  const generationsQuery = useFeeGenerations({
    source: 'SCHEDULE',
    recurring_schedule_id: scheduleId,
    page: state.page,
    limit: state.limit,
  });
  const [selectedBatch, setSelectedBatch] = React.useState<FeeGeneration | null>(null);

  return (
    <section aria-labelledby="schedule-history" className="space-y-3">
      <h2 id="schedule-history" className="text-h2">
        {t('schedules.detail.runHistoryTitle')}
      </h2>
      <DataTable
        tableId="schedule-history"
        caption={t('schedules.detail.runHistoryTitle')}
        columns={columns}
        // Every round here is automatic, so "how created" would repeat on every row.
        defaultColumnVisibility={{ source: false }}
        data={generationsQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        rowActions={(row) => [
          {
            intent: 'view',
            label: t('generations.viewBills'),
            onClick: () => setSelectedBatch(row),
          },
        ]}
        sorting={null}
        onSortingChange={() => {}}
        page={state.page}
        pageSize={state.limit}
        totalCount={generationsQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={generationsQuery.isLoading}
        isFetching={generationsQuery.isFetching}
        {...(generationsQuery.isError ? { error: t('schedules.errorMessage') } : {})}
        emptyState={{
          title: t('schedules.detail.runHistoryEmptyMessage'),
          explanation: t('schedules.detail.runHistoryEmptyExplanation'),
        }}
        announceResults={(count, total) =>
          t('generations.announceResults', { visible: count, total, count: total })
        }
      />
      <BatchBillsDrawer
        batch={selectedBatch}
        onOpenChange={(open) => !open && setSelectedBatch(null)}
      />
    </section>
  );
}

function ScheduleDetailPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { t, i18n } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const canManage = useHasPermission(Permission.SCHEDULE_MANAGE);

  const scheduleQuery = useRecurringSchedule(id);
  const schedule = scheduleQuery.data;
  const yearsQuery = useAcademicYears();
  const feesQuery = useFeeStructures(
    schedule ? { academic_year_id: schedule.academic_year_id } : {},
  );

  const openEdit = () => void navigate({ search: (prev) => ({ ...prev, edit: 1 }) });
  const closeEdit = useCloseFullPage(
    () => void navigate({ search: (prev) => ({ ...prev, edit: undefined }), replace: true }),
  );

  if (scheduleQuery.isLoading) return <ScheduleDetailPending />;
  if (scheduleQuery.isError || !schedule) {
    return (
      <ErrorState
        message={t('schedules.errorMessage')}
        onRetry={() => void scheduleQuery.refetch()}
      />
    );
  }

  const nextRun = nextRunDate(schedule, dhakaNow());
  const feeAmounts = new Map((feesQuery.data?.data ?? []).map((fee) => [fee.id, fee]));
  const feeNames = schedule.fee_structure_ids
    .map((feeId) => feeAmounts.get(feeId))
    .filter((fee) => fee !== undefined)
    .map((fee) => `${fee.name} (${formatServerAmount(fee.amount, regionConfig)})`)
    .join(', ');
  const facts = [
    {
      label: t('schedules.detail.factYear'),
      value:
        yearsQuery.data?.data.find((year) => year.id === schedule.academic_year_id)?.name ?? '—',
    },
    { label: t('schedules.columnAudience'), value: <AudienceCell schedule={schedule} /> },
    {
      label: t('schedules.columnRule'),
      value: ruleSummary(schedule, t, regionConfig, i18n.language),
    },
    {
      label: t('schedules.detail.factDueDays'),
      value: t('schedules.detail.dueDaysValue', {
        count: schedule.due_days_after_period_start,
        n: formatNumber(schedule.due_days_after_period_start, regionConfig),
      }),
    },
    {
      label: t('schedules.columnNextRun'),
      value: nextRun ? formatDate(nextRun, regionConfig) : '—',
    },
    {
      label: t('schedules.detail.factPeriod'),
      value: schedule.ends_on
        ? formatDateRange(
            parseServerDate(schedule.starts_on),
            parseServerDate(schedule.ends_on),
            regionConfig,
          )
        : t('schedules.detail.fromDate', {
            date: formatDate(parseServerDate(schedule.starts_on), regionConfig),
          }),
    },
    { label: t('schedules.detail.factFees'), value: feeNames || '—' },
  ];

  return (
    <>
      <DetailShell
        name={schedule.name}
        statusBadge={
          <StatusBadge
            tone={schedule.is_active ? 'success' : 'neutral'}
            label={schedule.is_active ? t('schedules.statusActive') : t('schedules.statusInactive')}
          />
        }
        facts={facts}
        actions={[
          {
            id: 'edit',
            label: t('schedules.edit'),
            icon: <PencilIcon />,
            priority: 'primary',
            allowed: canManage,
            onClick: openEdit,
          },
        ]}
      >
        <div className="space-y-6">
          <ExclusionsTable
            scheduleId={id}
            exclusions={schedule.exclusions ?? []}
            canManage={canManage}
          />
          <ScheduleRunHistory scheduleId={id} />
        </div>
      </DetailShell>

      {canManage && search.edit === 1 && (
        <ScheduleFormDialog
          open
          mode="edit"
          schedule={schedule}
          onOpenChange={(open) => {
            if (!open) closeEdit();
          }}
          onSaved={closeEdit}
        />
      )}
    </>
  );
}

function ScheduleDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
