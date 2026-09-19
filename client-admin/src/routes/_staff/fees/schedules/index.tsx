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
 * Paging is client-side: `GET /fees/schedules` returns the tenant's whole
 * list and rejects `page`/`limit` query params outright, so `ListShell`'s
 * paging slices the fetched array instead of driving the request.
 */
import { Permission } from '@biddaloy/shared';
import { Button, CachedDataNotice, DataTableColumn, RoutePending } from '@biddaloy/ui/components';
import {
  recurringSchedulesQueryOptions,
  useClasses,
  useHasPermission,
  useRecurringSchedules,
  useUpdateRecurringSchedule,
  type Class,
  type MonthlyRuleDay,
  type RecurringSchedule,
  type Weekday,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
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
  if (schedule.rule.kind === 'MONTHLY') {
    const day = schedule.rule.day_of_month;
    return day === 'LAST' ? t('schedules.ruleMonthlyLast') : t('schedules.ruleMonthly', { day });
  }
  // `rule.weekdays` are ISO weekday numbers (1 = Monday .. 7 = Sunday), so
  // they have to be turned into names — joining the raw array rendered
  // "Every 1, 4".
  const days = (schedule.rule.weekdays ?? [])
    .map((day) => t(`weekdays.${day}`, { ns: 'common', defaultValue: String(day) }))
    .join(', ');
  return t('schedules.ruleWeekly', { days });
}

/** `classesById`/`sectionsById` resolve `audience.class_id`/`section_id`
 * into real names — without them, a class-scoped schedule produced an
 * empty `parts` and fell through to the "whole school" default, wrongly
 * labeling a scoped billing audience as unscoped. */
function audienceSummary(
  schedule: RecurringSchedule,
  t: TFunction<'fees', undefined>,
  classesById: Map<string, string>,
  sectionsById: Map<string, string>,
): string {
  const parts: string[] = [];
  const { class_id, section_id } = schedule.audience;
  // `RecurringScheduleAudienceDto` allows `section_id` without `class_id`
  // (the create form never offers that combination, but a schedule created
  // some other way, or the DTO changing later, can still reach it) --
  // branch on either being set, not just class_id, or a section-only
  // audience wrongly showed "Whole school".
  if (class_id || section_id) {
    const className = class_id
      ? (classesById.get(class_id) ?? t('schedules.unknownClass'))
      : t('schedules.unknownClass');
    parts.push(
      section_id
        ? `${className} — ${sectionsById.get(section_id) ?? t('schedules.unknownSection')}`
        : className,
    );
  } else {
    parts.push(t('schedules.wholeSchool'));
  }
  // `audience.enrollment_status` is required and `'ACTIVE'` is its only
  // accepted value, so every schedule is active-students-only. Stated
  // unconditionally rather than read from a flag that can't vary.
  if (schedule.audience.enrollment_status === 'ACTIVE') parts.push(t('schedules.activeOnly'));
  return parts.join(' · ');
}

const DHAKA_OFFSET_MS = 6 * 60 * 60_000;

/** Same "shift, then read UTC fields" trick `reports/collections.tsx`'s
 * `dhakaNow` uses, so "next run" never depends on the machine's own
 * timezone. */
function dhakaNow(): Date {
  return new Date(Date.now() + DHAKA_OFFSET_MS);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseDateOnly(value: string): Date {
  // `starts_on`/`ends_on` are `YYYY-MM-DD` — parsed as UTC midnight so
  // comparisons against `dhakaNow()`'s UTC-shifted clock line up.
  return new Date(`${value}T00:00:00.000Z`);
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function resolveMonthlyDay(year: number, month: number, day: MonthlyRuleDay): Date {
  const lastDay = daysInUtcMonth(year, month);
  const resolved = day === 'LAST' ? lastDay : Math.min(day, lastDay);
  return new Date(Date.UTC(year, month, resolved));
}

function nextMonthlyOccurrence(from: Date, day: MonthlyRuleDay): Date {
  const today = startOfUtcDay(from);
  let year = today.getUTCFullYear();
  let month = today.getUTCMonth();
  let candidate = resolveMonthlyDay(year, month, day);
  if (candidate < today) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    candidate = resolveMonthlyDay(year, month, day);
  }
  return candidate;
}

/** ISO weekday (1 = Monday .. 7 = Sunday) -> JS `getUTCDay()` (0 = Sunday
 * .. 6 = Saturday). Only Sunday differs, hence the modulo. */
function isoWeekdayToJsDay(day: Weekday): number {
  return day % 7;
}

function nextWeeklyOccurrence(from: Date, weekdays: Weekday[]): Date | null {
  if (weekdays.length === 0) return null;
  const target = new Set(weekdays.map(isoWeekdayToJsDay));
  const today = startOfUtcDay(from);
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = new Date(today.getTime() + offset * 86_400_000);
    if (target.has(candidate.getUTCDay())) return candidate;
  }
  return null;
}

/** Client-side "next run" — the period this schedule will next fire on,
 * computed from its rule/starts_on/ends_on, same Dhaka-arithmetic
 * convention `reports/collections.tsx` uses. Inactive schedules, or a
 * next occurrence past `ends_on`, have no next run. */
function nextRunDate(schedule: RecurringSchedule, now: Date): Date | null {
  if (!schedule.is_active) return null;
  const startsOn = parseDateOnly(schedule.starts_on);
  const from = now > startsOn ? now : startsOn;
  const candidate =
    schedule.rule.kind === 'MONTHLY'
      ? nextMonthlyOccurrence(from, schedule.rule.day_of_month ?? 1)
      : nextWeeklyOccurrence(from, schedule.rule.weekdays ?? []);
  if (!candidate) return null;
  if (schedule.ends_on && candidate > parseDateOnly(schedule.ends_on)) return null;
  return candidate;
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
      {/* "Run now" is gone: #679 specced `POST /fees/schedules/:id/run`,
          but the shipped server (#675) has no such route, so the button
          could only ever 404. Schedules fire from the scheduler; a one-off
          bill is the "Generate fees" flow. */}
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
  const regionConfig = useRegionConfig();
  const [state, actions] = useListShellState({ limit: 20 });

  // `GET /fees/schedules` is unpaginated and its query DTO whitelists only
  // `academic_year_id`/`is_active` — the old interim `{ page, limit }`
  // params 400'd under the server's `forbidNonWhitelisted` pipe. The list
  // is tenant-wide and small, so it's fetched whole and paged client-side.
  const schedulesQuery = useRecurringSchedules({});
  const allSchedules = React.useMemo(() => schedulesQuery.data ?? [], [schedulesQuery.data]);
  const pagedSchedules = React.useMemo(
    () => allSchedules.slice((state.page - 1) * state.limit, state.page * state.limit),
    [allSchedules, state.page, state.limit],
  );
  // Resolves audience.class_id/section_id to real names for
  // audienceSummary() below — one school-wide fetch, `Class.sections` is
  // already embedded so this needs no per-class follow-up request.
  const classesQuery = useClasses({});
  const { classesById, sectionsById } = React.useMemo(() => {
    const classes = new Map<string, string>();
    const sections = new Map<string, string>();
    for (const klass of classesQuery.data?.data ?? []) {
      classes.set(klass.id, klass.name);
      for (const section of (klass as Class).sections ?? []) {
        sections.set(section.id, section.section_name);
      }
    }
    return { classesById: classes, sectionsById: sections };
  }, [classesQuery.data]);
  const canManage = useHasPermission(Permission.SCHEDULE_MANAGE);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<RecurringSchedule | null>(null);
  const [cloning, setCloning] = React.useState<RecurringSchedule | null>(null);
  const now = React.useMemo(() => dhakaNow(), []);

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
      accessorFn: (row) => audienceSummary(row, t, classesById, sectionsById),
    },
    {
      id: 'rule',
      header: t('schedules.columnRule'),
      accessorFn: (row) => ruleSummary(row, t),
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
      accessorFn: (row) => row.last_run_period ?? '—',
    },
    {
      id: 'active',
      header: t('schedules.columnActive'),
      // `t('schedules.activate')`/`deactivate` are the *action* labels
      // (what clicking the toggle button below does), not state labels —
      // using them here showed "Activate" for an already-active schedule
      // and vice versa, backwards from what this column claims to show.
      accessorFn: (row) =>
        row.is_active ? t('schedules.statusActive') : t('schedules.statusInactive'),
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
        data={pagedSchedules}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={() => {}}
        page={state.page}
        pageSize={state.limit}
        totalCount={allSchedules.length}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
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
