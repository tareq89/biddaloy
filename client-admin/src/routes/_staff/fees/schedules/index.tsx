/**
 * `/fees/schedules` — [16.7.5]. Full CRUD list for `RecurringSchedule`:
 * create, edit, clone into another academic year, run-now, and
 * deactivate/activate — same `ListShell` pattern as `fee-structures/
 * index.tsx`, adapted for a per-row rule summary instead of a filter
 * bar (schedules are few enough per school that filtering hasn't
 * mattered yet; add one if that stops being true).
 */
import { Permission } from '@biddaloy/shared';
import { Button, CachedDataNotice, DataTableColumn, RoutePending } from '@biddaloy/ui/components';
import {
  recurringSchedulesQueryOptions,
  useHasPermission,
  useRecurringSchedules,
  useRunRecurringScheduleNow,
  useUpdateRecurringSchedule,
  type RecurringSchedule,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { CloneScheduleDialog } from './-clone-dialog';
import { ScheduleFormDialog } from './-schedule-form-dialog';

export const Route = createFileRoute('/_staff/fees/schedules/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(recurringSchedulesQueryOptions({})).catch(swallowUnlessOffline),
      loadRouteNamespaces('fees'),
    ]),
  pendingComponent: SchedulesListPending,
  component: SchedulesListPage,
});

function ruleSummary(schedule: RecurringSchedule, t: TFunction<'fees', undefined>): string {
  if (schedule.rule.mode === 'MONTHLY') {
    const day = schedule.rule.day_of_month;
    return day === 'LAST' ? t('schedules.ruleMonthlyLast') : t('schedules.ruleMonthly', { day });
  }
  return t('schedules.ruleWeekly', { days: (schedule.rule.weekdays ?? []).join(', ') });
}

function audienceSummary(schedule: RecurringSchedule, t: TFunction<'fees', undefined>): string {
  const parts: string[] = [];
  if (!schedule.audience.class_id) parts.push(t('schedules.wholeSchool'));
  if (schedule.audience.active_only) parts.push(t('schedules.activeOnly'));
  return parts.length > 0 ? parts.join(' · ') : t('schedules.wholeSchool');
}

/** Row actions live in their own component so `useUpdateRecurringSchedule`
 * can be bound to this row's id — hooks can't be called conditionally
 * inside a column's `cell` callback for every row from one shared call. */
function ScheduleRowActions({
  schedule,
  canManage,
  onEdit,
  onClone,
}: {
  schedule: RecurringSchedule;
  canManage: boolean;
  onEdit: () => void;
  onClone: () => void;
}) {
  const { t } = useTranslation('fees');
  const runNow = useRunRecurringScheduleNow();
  const toggleActive = useUpdateRecurringSchedule(schedule.id);

  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        className="text-sm font-medium text-primary underline-offset-2 hover:underline"
        onClick={onEdit}
      >
        {t('schedules.edit')}
      </button>
      <button
        type="button"
        className="text-sm font-medium text-primary underline-offset-2 hover:underline"
        onClick={onClone}
      >
        {t('schedules.clone')}
      </button>
      {canManage && (
        <button
          type="button"
          className="text-sm font-medium text-primary underline-offset-2 hover:underline"
          disabled={runNow.isPending}
          onClick={() => runNow.mutate(schedule.id)}
        >
          {t('schedules.runNow')}
        </button>
      )}
      {canManage && (
        <button
          type="button"
          className="text-sm font-medium text-destructive underline-offset-2 hover:underline"
          disabled={toggleActive.isPending}
          onClick={() => toggleActive.mutate({ is_active: !schedule.is_active })}
        >
          {schedule.is_active ? t('schedules.deactivate') : t('schedules.activate')}
        </button>
      )}
    </div>
  );
}

function SchedulesListPage() {
  const { t } = useTranslation('fees');
  const [state] = useListShellState({ limit: 20 });

  const schedulesQuery = useRecurringSchedules({});
  const canManage = useHasPermission(Permission.FEE_GENERATE);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<RecurringSchedule | null>(null);
  const [cloning, setCloning] = React.useState<RecurringSchedule | null>(null);

  const columns: DataTableColumn<RecurringSchedule>[] = [
    {
      id: 'name',
      header: t('schedules.columnName'),
      accessorFn: (row) => (
        <Link
          to="/fees/schedules/$id"
          params={{ id: row.id }}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {row.name}
        </Link>
      ),
      card: 'title',
    },
    {
      id: 'audience',
      header: t('schedules.columnAudience'),
      accessorFn: (row) => audienceSummary(row, t),
    },
    {
      id: 'rule',
      header: t('schedules.columnRule'),
      accessorFn: (row) => ruleSummary(row, t),
    },
    {
      id: 'lastRun',
      header: t('schedules.columnLastRun'),
      accessorFn: (row) => row.last_run_period ?? '—',
    },
    {
      id: 'active',
      header: t('schedules.columnActive'),
      accessorFn: (row) => (row.is_active ? t('schedules.activate') : t('schedules.deactivate')),
    },
    {
      id: 'actions',
      header: t('schedules.columnActions'),
      pinned: true,
      accessorFn: (row) => (
        <ScheduleRowActions
          schedule={row}
          canManage={canManage}
          onEdit={() => setEditing(row)}
          onClone={() => setCloning(row)}
        />
      ),
    },
  ];

  return (
    <>
      <CachedDataNotice queryKey={recurringSchedulesQueryOptions({}).queryKey} />
      <ListShell
        title={t('schedules.title')}
        primaryAction={
          canManage && (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              {t('schedules.addSchedule')}
            </Button>
          )
        }
        tableId="recurring-schedules-list"
        caption={t('schedules.title')}
        columns={columns}
        data={schedulesQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={() => {}}
        page={state.page}
        pageSize={state.limit}
        totalCount={schedulesQuery.data?.total ?? 0}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={schedulesQuery.isLoading}
        isFetching={schedulesQuery.isFetching}
        {...(schedulesQuery.isError ? { error: t('schedules.errorMessage') } : {})}
        emptyMessage={t('schedules.emptyMessage')}
        announceResults={(count, total) =>
          t('schedules.announceResults', { visible: count, total, count: total })
        }
      />

      {canManage && (
        <ScheduleFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          mode="create"
          onSaved={() => setCreateOpen(false)}
        />
      )}

      {canManage && editing && (
        <ScheduleFormDialog
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          mode="edit"
          schedule={editing}
          onSaved={() => setEditing(null)}
        />
      )}

      {canManage && cloning && (
        <CloneScheduleDialog
          open={cloning !== null}
          onOpenChange={(open) => !open && setCloning(null)}
          schedule={cloning}
          onCloned={() => setCloning(null)}
        />
      )}
    </>
  );
}

function SchedulesListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
