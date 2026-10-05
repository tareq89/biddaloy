/**
 * `/fees/schedules` — [16.7.5]. Full CRUD list for `RecurringSchedule`:
 * create, edit, clone into another academic year, and
 * deactivate/activate — same `ListShell` pattern as `fee-structures/
 * index.tsx`, adapted for a per-row rule summary instead of a filter
 * bar (schedules are few enough per school that filtering hasn't
 * mattered yet; add one if that stops being true). Sorting is a
 * deliberate stub (`sorting={null}`) same as `fee-structures/index.tsx`
 * used to be — no server-sortable field exists on this contract.
 *
 * Unpaginated: `GET /fees/schedules` returns the tenant's whole list and rejects `page`/`limit`
 * query params, so the table shows every rule with a "Total n" footer. The rule form lives in the
 * URL (`?new=1` / `?edit=<id>`, D22) and only mounts while one of them is set (B10).
 */
import { Permission } from '@biddaloy/shared';
import {
  CachedDataNotice,
  ConfirmDialog,
  RoutePending,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  recurringSchedulesQueryOptions,
  useHasPermission,
  useRecurringSchedules,
  useUpdateRecurringSchedule,
  type RecurringSchedule,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

import { AudienceCell } from './-audience-cell';
import { CloneScheduleDialog } from './-clone-dialog';
import { ScheduleFormDialog } from './-schedule-form-dialog';
import { dhakaNow, lastBilledLabel, nextRunDate, ruleSummary } from './-schedule-summary';

const schedulesSearchSchema = z.object({
  new: z.literal(1).optional().catch(undefined),
  edit: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/fees/schedules/')({
  validateSearch: schedulesSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(recurringSchedulesQueryOptions({})).catch(swallowUnlessOffline),
      loadRouteNamespaces('fees'),
    ]),
  pendingComponent: SchedulesListPending,
  component: SchedulesListPage,
});

/** Switching a rule on or off asks first — off stops billing, on starts billing families again. */
function ToggleScheduleConfirm({
  schedule,
  onDone,
}: {
  schedule: RecurringSchedule;
  onDone: () => void;
}) {
  const { t } = useTranslation('fees');
  const toggleActive = useUpdateRecurringSchedule(schedule.id);

  return (
    <ConfirmDialog
      open
      tone="default"
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
      title={
        schedule.is_active
          ? t('schedules.deactivateConfirmTitle')
          : t('schedules.activateConfirmTitle')
      }
      description={
        schedule.is_active
          ? t('schedules.deactivateConfirmDescription')
          : t('schedules.activateConfirmDescription')
      }
      confirmLabel={schedule.is_active ? t('schedules.deactivate') : t('schedules.activate')}
      busy={toggleActive.isPending}
      onConfirm={() =>
        toggleActive.mutate({ is_active: !schedule.is_active }, { onSuccess: onDone })
      }
    />
  );
}

function SchedulesListPage() {
  const { t, i18n } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // `GET /fees/schedules` is unpaginated and its query DTO whitelists only
  // `academic_year_id`/`is_active` — the old interim `{ page, limit }`
  // params 400'd under the server's `forbidNonWhitelisted` pipe.
  const schedulesQuery = useRecurringSchedules({});
  const allSchedules = React.useMemo(() => schedulesQuery.data ?? [], [schedulesQuery.data]);
  const canManage = useHasPermission(Permission.SCHEDULE_MANAGE);
  const [cloning, setCloning] = React.useState<RecurringSchedule | null>(null);
  const [toggling, setToggling] = React.useState<RecurringSchedule | null>(null);
  const now = React.useMemo(() => dhakaNow(), []);

  const openNew = () => void navigate({ search: (prev) => ({ ...prev, new: 1 }) });
  const openEdit = (id: string) => void navigate({ search: (prev) => ({ ...prev, edit: id }) });
  const closeForm = useCloseFullPage(
    () =>
      void navigate({
        search: (prev) => ({ ...prev, new: undefined, edit: undefined }),
        replace: true,
      }),
  );
  const editing = search.edit
    ? allSchedules.find((schedule) => schedule.id === search.edit)
    : undefined;

  const columns: DataTableColumn<RecurringSchedule>[] = [
    {
      id: 'name',
      header: t('schedules.columnName'),
      accessorFn: (row) => row.name,
      card: 'title',
    },
    {
      id: 'audience',
      header: t('schedules.columnAudience'),
      accessorFn: (row) => <AudienceCell schedule={row} />,
      card: 'subtitle',
    },
    {
      id: 'rule',
      header: t('schedules.columnRule'),
      accessorFn: (row) => ruleSummary(row, t, regionConfig, i18n.language),
    },
    {
      id: 'nextRun',
      header: t('schedules.columnNextRun'),
      accessorFn: (row) => {
        const next = nextRunDate(row, now);
        return next ? formatDate(next, regionConfig) : '—';
      },
    },
    {
      id: 'lastRun',
      header: t('schedules.columnLastRun'),
      accessorFn: (row) =>
        row.last_run_period === null ? (
          <span className="text-text-secondary">{t('schedules.neverBilled')}</span>
        ) : (
          lastBilledLabel(row, t, regionConfig)
        ),
    },
    {
      id: 'active',
      header: t('schedules.columnActive'),
      // `t('schedules.activate')`/`deactivate` are the *action* labels, not state labels.
      accessorFn: (row) => (
        <StatusBadge
          tone={row.is_active ? 'success' : 'neutral'}
          label={row.is_active ? t('schedules.statusActive') : t('schedules.statusInactive')}
        />
      ),
      card: 'badge',
    },
  ];

  return (
    <>
      <CachedDataNotice queryKey={recurringSchedulesQueryOptions({}).queryKey} />
      <ListShell
        title={t('schedules.title')}
        subtitle={t('schedules.subtitle')}
        actions={[
          {
            id: 'add',
            label: t('schedules.addSchedule'),
            icon: <PlusIcon />,
            priority: 'primary',
            allowed: canManage,
            onClick: openNew,
          },
        ]}
        tableId="recurring-schedules-list"
        caption={t('schedules.title')}
        columns={columns}
        data={allSchedules}
        getRowId={(row) => row.id}
        // "Run now" is gone: #679 specced `POST /fees/schedules/:id/run`, but the shipped
        // server (#675) has no such route. Schedules fire from the scheduler.
        rowActions={(row) => [
          { intent: 'view', label: t('schedules.view'), to: `/fees/schedules/${row.id}` },
          {
            intent: 'edit',
            label: t('schedules.edit'),
            allowed: canManage,
            onClick: () => openEdit(row.id),
          },
          {
            intent: 'duplicate',
            label: t('schedules.clone'),
            allowed: canManage,
            onClick: () => setCloning(row),
          },
          row.is_active
            ? {
                intent: 'archive',
                label: t('schedules.deactivate'),
                allowed: canManage,
                onClick: () => setToggling(row),
              }
            : {
                intent: 'restore',
                label: t('schedules.activate'),
                allowed: canManage,
                onClick: () => setToggling(row),
              },
        ]}
        sorting={null}
        onSortingChange={() => {}}
        paginated={false}
        totalCount={allSchedules.length}
        loading={schedulesQuery.isLoading}
        isFetching={schedulesQuery.isFetching}
        {...(schedulesQuery.isError ? { error: t('schedules.errorMessage') } : {})}
        emptyState={{
          title: t('schedules.emptyMessage'),
          explanation: t('schedules.emptyExplanation'),
          ...(canManage ? { action: { label: t('schedules.addSchedule'), onClick: openNew } } : {}),
        }}
        announceResults={(count, total) =>
          t('schedules.announceResults', { visible: count, total, count: total })
        }
      />

      {canManage && search.new === 1 && (
        <ScheduleFormDialog
          open
          onOpenChange={(open) => {
            if (!open) closeForm();
          }}
          mode="create"
          onSaved={closeForm}
        />
      )}

      {canManage && editing && (
        <ScheduleFormDialog
          open
          onOpenChange={(open) => {
            if (!open) closeForm();
          }}
          mode="edit"
          schedule={editing}
          onSaved={closeForm}
        />
      )}

      {canManage && cloning && (
        <CloneScheduleDialog
          open
          onOpenChange={(open) => !open && setCloning(null)}
          schedule={cloning}
          onCloned={() => setCloning(null)}
        />
      )}

      {canManage && toggling && (
        <ToggleScheduleConfirm schedule={toggling} onDone={() => setToggling(null)} />
      )}
    </>
  );
}

function SchedulesListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
