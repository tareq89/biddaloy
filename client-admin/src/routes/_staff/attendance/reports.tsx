/**
 * [9.10] `/attendance/reports` — two views over [9.4]'s read endpoints,
 * one page.
 *
 * `view=summary` is one section's whole-roster attendance for a month.
 * The plan's own hook list names `GET /attendance/sections/:sectionId/
 * summary` (`useSectionSummary`) as this view's data source, but that
 * endpoint's `SectionSummaryDto.students` is `AttendanceSummaryDto[]` —
 * `student_id` and day counts only, **no `roll_number`/`full_name`**
 * (see `attendance-summary.dto.ts`). A report table with no student
 * names would be useless, so this view instead reads `GET /attendance/
 * sections/:sectionId/register-matrix` (`useRegisterMatrix`, [9.9]/[9.6]'s
 * existing hook) — each `RegisterMatrixRowDto` already carries
 * `roll_number`/`full_name` *and* a nested per-student `summary:
 * AttendanceSummaryDto`, which is exactly this table's row shape.
 * `useSectionSummary`/`sectionSummaryQueryOptions` are still exported
 * from `ui/src/hooks/attendance.ts` per the plan (a real, useful endpoint
 * — [9.6]'s `$sectionId.tsx` marking screen could reasonably grow a
 * "today's roll-up" strip from it later), just not this page's source.
 * Flagged for the parent to fold back into the published plan.
 *
 * `view=flags` is the tenant-wide low-attendance flag list (`GET
 * /attendance/flags/low`), optionally narrowed by class/section — this
 * one needs no section picked, since it's already per-student across the
 * whole filter scope.
 *
 * Same `ListShell` + `FilterBar` + `DataTable` composition, and the same
 * `useListShellState` URL wiring, as `fees/dues.tsx`.
 *
 * `attendance_percentage` is `null` whenever `marked_days === 0` — [9.4]'s
 * own contract, already excluded from `/flags/low`'s results server-side.
 * This page never re-filters or re-derives that on the client: `null`
 * renders as an em dash, never `0%`.
 */
import { Permission } from '@biddaloy/shared';
import { Button, RoutePending, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import {
  useClasses,
  useClassSections,
  useHasPermission,
  useLowAttendance,
  useRegisterMatrix,
  type LowAttendanceFlag,
  type RegisterMatrixRow,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';
import { SendReminderDialog } from '../students/-send-reminder-dialog';

interface ReportsFilters {
  class_id?: string | undefined;
  section_id?: string | undefined;
  month?: string | undefined;
  threshold?: string | undefined;
  view?: string | undefined;
}

/** Trailing 12 months plus the current one, most recent first — plain
 * `YYYY-MM` values as both the option value *and* its label, so no
 * localized month name is needed (`fees/dues.tsx`'s own comment on why
 * `boundary/no-raw-intl` rules out `Intl.DateTimeFormat` here). */
function trailingMonthOptions(now: Date): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    options.push({ value: iso, label: iso });
  }
  return options;
}

function currentMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** `resolveDateRange`'s client-side mirror (`attendance-summary.dto.ts`) —
 * `/attendance/flags/low` wants an explicit `from`/`to`, not a `month`
 * convenience param. Plain UTC arithmetic, never a local-timezone `Date`,
 * same reasoning as the server's own version. */
function monthToRange(month: string): { from: string; to: string } {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const from = `${month}-01`;
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const to = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

export const Route = createFileRoute('/_staff/attendance/reports')({
  loader: () => loadRouteNamespaces('attendance', 'students', 'common'),
  pendingComponent: ReportsPending,
  component: ReportsPage,
});

function ReportsPage() {
  // `useRegionConfig()` has no ambient provider above the route tree —
  // same wrap `academic-years/index.tsx` documents for itself.
  const regionConfig = useTenantRegionConfig();
  return (
    <RegionConfigProvider value={regionConfig}>
      <ReportsPageContent />
    </RegionConfigProvider>
  );
}

function ReportsPageContent() {
  const { t } = useTranslation('attendance');
  const regionConfig = useRegionConfig();
  const [state, actions] = useListShellState({ limit: 20 });
  const filters = state.filters as ReportsFilters;
  const view = filters.view === 'flags' ? 'flags' : 'summary';
  const month = filters.month ?? currentMonthIso();
  const { from, to } = monthToRange(month);
  // A free-text filter — reject anything that doesn't parse to a real
  // number rather than forwarding NaN, which would both request
  // `threshold: NaN` server-side and make `isLow`'s `percentage < NaN`
  // silently false (never flagging a row) for the rest of the session.
  const parsedThreshold =
    filters.threshold !== undefined && filters.threshold !== ''
      ? Number(filters.threshold)
      : undefined;
  const threshold =
    parsedThreshold !== undefined && Number.isFinite(parsedThreshold) ? parsedThreshold : undefined;

  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(filters.class_id);

  const registerQuery = useRegisterMatrix(
    view === 'summary' ? filters.section_id : undefined,
    month,
  );
  const flagsQuery = useLowAttendance({
    from,
    to,
    ...(threshold !== undefined ? { threshold } : {}),
    ...(filters.class_id !== undefined ? { class_id: filters.class_id } : {}),
    ...(filters.section_id !== undefined ? { section_id: filters.section_id } : {}),
    page: state.page,
    limit: state.limit,
  });

  const canSendReminder = useHasPermission(Permission.COMMUNICATION_BULK_SEND);
  const [reminderStudentId, setReminderStudentId] = React.useState<string | null>(null);

  function handleFilterChange(patch: Record<string, string | null>) {
    const next = { ...patch };
    if ('class_id' in next) next.section_id = null;
    actions.setFilters(next);
  }

  function isLow(percentage: number | null): boolean {
    if (percentage === null || threshold === undefined) return false;
    return percentage < threshold;
  }

  function renderPercentage(percentage: number | null, low: boolean) {
    if (percentage === null) return '—';
    const label = `${formatNumber(percentage, regionConfig)}%`;
    if (!low) return label;
    return (
      <span className="inline-flex items-center gap-1.5">
        {label}
        <StatusBadge domain="attendance" status="LOW" />
      </span>
    );
  }

  function renderActions(studentId: string) {
    return (
      <span className="inline-flex items-center gap-2">
        <Link to="/students/$studentId" params={{ studentId }} className="text-sm font-medium">
          {t('reports.viewStudent')}
        </Link>
        {canSendReminder && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setReminderStudentId(studentId)}
          >
            {t('reports.sendReminder')}
          </Button>
        )}
      </span>
    );
  }

  const summaryColumns: DataTableColumn<RegisterMatrixRow>[] = [
    {
      id: 'roll_number',
      header: t('reports.columnRoll'),
      accessorFn: (row) => formatNumber(row.roll_number, regionConfig),
      card: 'subtitle',
    },
    {
      id: 'full_name',
      header: t('reports.columnStudent'),
      accessorFn: (row) => row.full_name,
      card: 'title',
    },
    {
      id: 'present_days',
      header: t('reports.columnPresent'),
      accessorFn: (row) => formatNumber(row.summary.present_days, regionConfig),
      align: 'end',
    },
    {
      id: 'absent_days',
      header: t('reports.columnAbsent'),
      accessorFn: (row) => formatNumber(row.summary.absent_days, regionConfig),
      align: 'end',
    },
    {
      id: 'late_days',
      header: t('reports.columnLate'),
      accessorFn: (row) => formatNumber(row.summary.late_days, regionConfig),
      align: 'end',
    },
    {
      id: 'leave_days',
      header: t('reports.columnLeave'),
      accessorFn: (row) => formatNumber(row.summary.leave_days, regionConfig),
      align: 'end',
    },
    {
      id: 'working_days',
      header: t('reports.columnWorkingDays'),
      accessorFn: (row) => formatNumber(row.summary.working_days, regionConfig),
      align: 'end',
    },
    {
      id: 'attendance_percentage',
      header: t('reports.columnAttendance'),
      accessorFn: (row) =>
        renderPercentage(
          row.summary.attendance_percentage,
          isLow(row.summary.attendance_percentage),
        ),
      align: 'end',
      card: 'badge',
    },
    {
      id: 'actions',
      header: t('reports.columnActions'),
      accessorFn: (row) => renderActions(row.student_id),
      pinned: true,
      card: 'actions',
    },
  ];

  const flagsColumns: DataTableColumn<LowAttendanceFlag>[] = [
    {
      id: 'roll_number',
      header: t('reports.columnRoll'),
      accessorFn: (row) => formatNumber(row.roll_number, regionConfig),
      card: 'subtitle',
    },
    {
      id: 'full_name',
      header: t('reports.columnStudent'),
      accessorFn: (row) => row.student_name,
      card: 'title',
    },
    {
      id: 'class_name',
      header: t('reports.columnClass'),
      accessorFn: (row) => row.class_name,
    },
    {
      id: 'section_name',
      header: t('reports.columnSection'),
      accessorFn: (row) => row.section_name,
    },
    {
      id: 'present_days',
      header: t('reports.columnPresent'),
      accessorFn: (row) => formatNumber(row.present_days, regionConfig),
      align: 'end',
    },
    {
      id: 'absent_days',
      header: t('reports.columnAbsent'),
      accessorFn: (row) => formatNumber(row.absent_days, regionConfig),
      align: 'end',
    },
    {
      id: 'attendance_percentage',
      header: t('reports.columnAttendance'),
      // Every row `/attendance/flags/low` returns is, by definition,
      // below the effective threshold server-side already applied — no
      // client-side `isLow` recomputation needed here.
      accessorFn: (row) => renderPercentage(row.attendance_percentage, true),
      align: 'end',
      card: 'badge',
    },
    {
      id: 'actions',
      header: t('reports.columnActions'),
      accessorFn: (row) => renderActions(row.student_id),
      pinned: true,
      card: 'actions',
    },
  ];

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'view',
      label: t('reports.viewLabel'),
      allLabel: t('reports.viewSummary'),
      options: [{ value: 'flags', label: t('reports.viewFlags') }],
    },
    {
      kind: 'select',
      key: 'month',
      label: t('reports.monthLabel'),
      allLabel: currentMonthIso(),
      options: trailingMonthOptions(new Date()),
    },
    {
      kind: 'select',
      key: 'class_id',
      label: t('reports.classLabel'),
      allLabel: t('reports.allClasses'),
      options: (classesQuery.data?.data ?? []).map((klass) => ({
        value: klass.id,
        label: klass.name,
      })),
    },
    {
      kind: 'select',
      key: 'section_id',
      label: t('reports.sectionLabel'),
      allLabel: t('reports.allSections'),
      options: (sectionsQuery.data ?? []).map((section) => ({
        value: section.id,
        label: section.section_name,
      })),
    },
    {
      kind: 'text',
      key: 'threshold',
      label: t('reports.thresholdLabel'),
      placeholder: t('reports.thresholdPlaceholder'),
    },
  ];

  const noSectionSelected = view === 'summary' && filters.section_id === undefined;
  const rows =
    view === 'summary' ? (registerQuery.data?.rows ?? []) : (flagsQuery.data?.data ?? []);
  const totalCount = view === 'summary' ? rows.length : (flagsQuery.data?.total ?? 0);
  const loading = view === 'summary' ? registerQuery.isLoading : flagsQuery.isLoading;
  const isFetching = view === 'summary' ? registerQuery.isFetching : flagsQuery.isFetching;
  const isError = view === 'summary' ? registerQuery.isError : flagsQuery.isError;

  return (
    <>
      <ListShell
        title={t('reports.title')}
        filters={{ fields: filterFields, values: state.filters, onChange: handleFilterChange }}
        tableId="attendance-reports"
        caption={t('reports.caption')}
        // Two distinct row shapes (`RegisterMatrixRow` vs `LowAttendanceFlag`)
        // share one `<DataTable>` instance, switched on `view` — TS has no
        // way to correlate `columns`/`data`/`getRowId`'s three separate
        // union types back into one matched generic, so these two casts
        // (not `unknown`, `never` — a type no real value satisfies,
        // matching this file's other "trust the runtime `view` check"
        // casts) tell it what every other branch here already guarantees
        // at runtime. `tsc --noEmit`'s whole-program inference needs both;
        // type-aware ESLint's per-file inference only ever flags one of
        // the two as redundant (which one flips depending on unrelated
        // edits elsewhere in the file) — a real discrepancy between the
        // two checkers' inference order on this generic component, not a
        // mistake in either direction.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        columns={(view === 'summary' ? summaryColumns : flagsColumns) as DataTableColumn<never>[]}
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        data={rows as never[]}
        getRowId={(row: { student_id: string }) => row.student_id}
        // Neither view is server-sortable — no `sort_by` column on either
        // `register-matrix` or `flags/low` — so this is always `null`,
        // never wired to a header click the way `fees/dues.tsx`'s
        // `state.sorting` is.
        sorting={null}
        onSortingChange={() => undefined}
        page={state.page}
        pageSize={state.limit}
        totalCount={totalCount}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={loading}
        isFetching={isFetching}
        {...(noSectionSelected
          ? { emptyMessage: t('reports.selectSectionPrompt') }
          : isError
            ? { error: t('reports.errorMessage') }
            : { emptyMessage: t('reports.emptyMessage') })}
        announceResults={(count, total) => t('reports.announceResults', { visible: count, total })}
      />
      <SendReminderDialog
        open={reminderStudentId !== null}
        onOpenChange={(open) => !open && setReminderStudentId(null)}
        studentIds={reminderStudentId ? [reminderStudentId] : []}
        onSent={() => setReminderStudentId(null)}
      />
    </>
  );
}

function ReportsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
