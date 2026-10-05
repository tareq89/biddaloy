import { AttendanceStatus } from '@biddaloy/shared';
import {
  AttendanceMonthGrid,
  Card,
  EmptyState,
  ErrorState,
  RoutePending,
  Skeleton,
  StatusBadge,
  StudentPicker,
  type AttendanceDayCell,
} from '@biddaloy/ui/components';
import {
  myStudentsQueryOptions,
  useMyStudents,
  useStudentAttendanceDays,
  useStudentAttendanceSummary,
  type Student,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import {
  formatDate,
  formatMonth,
  formatNumber,
  parseServerDate,
  toIsoDate,
} from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

/**
 * [9.9] — one guardian, one child, one month: the portal's per-child
 * attendance calendar. Every endpoint behind this route shipped with
 * [9.4] (`GET /attendance/students/:studentId/days`, `.../summary`) —
 * this ticket is entirely frontend, the same shape [5.3]'s `fees.tsx` was
 * for the fee breakdown, and this route is built from that one's proven
 * structure: `?student=` and `?month=` are the two URL params, both
 * rewritten by real `Link`s (never client-side-only state) so the browser
 * Back button walks both a student switch and a month step.
 *
 * `?student=` is a UI hint only — `FamilyAccessService.assertLinked`
 * re-checks the link server-side on every request, so an id naming an
 * unlinked student simply 403s into the error frame rather than needing
 * to be hidden client-side.
 *
 * Region config is a **value-less** `RegionConfigProvider`, not
 * `useTenantRegionConfig()` — identical reasoning to `fees.tsx` and
 * `portal/index.tsx`: `GET /schools/:id/settings` is ADMIN-only, and a
 * PARENT calling it would 403 on every load for a value it would fall
 * back from anyway.
 */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const searchSchema = z.object({
  student: z.string().uuid().optional().catch(undefined),
  month: z
    .string()
    .regex(MONTH_PATTERN)
    .catch(() => currentMonthIso()),
});

export const Route = createFileRoute('/portal/attendance')({
  validateSearch: searchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      // [8.14.5]: same reasoning as `fees.tsx`'s own loader.
      queryClient.ensureQueryData(myStudentsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('portal', 'common'),
    ]),
  pendingComponent: PortalAttendancePending,
  component: PortalAttendanceRoute,
});

function PortalAttendanceRoute() {
  return (
    <RegionConfigProvider>
      <PortalAttendance />
    </RegionConfigProvider>
  );
}

/** The same "class section · roll" line `portal/index.tsx` and
 * `fees.tsx` render, from the same two keys. */
function useStudentMeta(): (student: Student) => string {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  return (student: Student) => {
    const className = student.class_section?.class?.name ?? null;
    const roll = formatNumber(student.roll_number, config);
    return className === null
      ? t('children.metaNoClass', { roll })
      : t('children.meta', {
          className,
          section: student.class_section?.section_name ?? '',
          roll,
        });
  };
}

function PortalAttendance() {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const search = Route.useSearch();
  const { t: tNav } = useTranslation('nav');
  const navigate = useNavigate();
  const studentMeta = useStudentMeta();
  // A day is a passing look, not a place: component state, keyed to the
  // student and month it was clicked in so changing either resets it.
  const [clicked, setClicked] = React.useState<{ key: string; date: string } | null>(null);

  const studentsQuery = useMyStudents();
  const students: Student[] = studentsQuery.data ?? [];

  const selected =
    students.find((student) => student.id === search.student) ?? students[0] ?? undefined;

  const daysQuery = useStudentAttendanceDays(selected?.id, search.month);
  const summaryQuery = useStudentAttendanceSummary(selected?.id, search.month);

  if (studentsQuery.isPending) return <AttendanceSkeleton label={t('attendance.loading')} />;

  if (studentsQuery.isError) {
    return (
      <ErrorState
        message={t('attendance.error.message')}
        retryLabel={t('attendance.error.retry')}
        onRetry={() => void studentsQuery.refetch()}
      />
    );
  }

  if (students.length === 0 || selected === undefined) {
    return (
      <PageContainer>
        <PageHeader title={tNav('items.portalAttendance')} />
        <EmptyState
          title={t('empty.title')}
          explanation={t('empty.explanation')}
          action={{ label: t('empty.action'), onClick: () => void studentsQuery.refetch() }}
        />
      </PageContainer>
    );
  }

  if (daysQuery.isPending || summaryQuery.isPending) {
    return <AttendanceSkeleton label={t('attendance.loading')} showPicker={students.length > 1} />;
  }

  if (daysQuery.isError || summaryQuery.isError) {
    return (
      <ErrorState
        message={t('attendance.error.message')}
        retryLabel={t('attendance.error.retry')}
        onRetry={() => {
          void daysQuery.refetch();
          void summaryQuery.refetch();
        }}
      />
    );
  }

  const days: AttendanceDayCell[] = daysQuery.data.map((day) => ({
    date: day.date,
    status: day.status,
    isWorkingDay: day.is_working_day,
    holidayName: day.holiday_name,
    minutesLate: day.minutes_late,
    remarks: day.remarks,
  }));

  const today = toIsoDate(new Date());
  const clickKey = `${selected.id}:${search.month}`;
  const effectiveDate =
    clicked?.key === clickKey
      ? clicked.date
      : search.month === currentMonthIso()
        ? today
        : undefined;
  const effectiveDay =
    effectiveDate === undefined ? null : (days.find((day) => day.date === effectiveDate) ?? null);

  return (
    <PageContainer>
      <PageHeader
        title={tNav('items.portalAttendance')}
        subtitle={`${selected.full_name} · ${studentMeta(selected)}`}
      />
      {students.length > 1 && (
        <StudentPicker
          label={t('attendance.pickerLabel')}
          items={students.map((student) => ({
            id: student.id,
            name: student.full_name,
            meta: studentMeta(student),
          }))}
          selectedId={selected.id}
          to="/portal/attendance"
        />
      )}
      <SummaryCard summary={summaryQuery.data} month={search.month} config={config} t={t} />
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <div className="min-w-0 flex-1">
          <AttendanceMonthGrid
            month={search.month}
            days={days}
            firstDayOfWeek={config.date.firstDayOfWeek}
            today={today}
            {...(effectiveDate === undefined ? {} : { selectedDate: effectiveDate })}
            onSelectDay={(day) => setClicked({ key: clickKey, date: day.date })}
            // `?month=` is rewritten (not client state) so Back still walks
            // month changes.
            onMonthChange={(month) =>
              void navigate({
                to: '/portal/attendance',
                search: { student: selected.id, month },
              })
            }
          />
          {days.length === 0 && (
            <p className="mt-3 text-text-secondary">{t('attendance.noRecordsThisMonth')}</p>
          )}
        </div>
        <AttendanceDayPanel day={effectiveDay} month={search.month} />
      </div>
    </PageContainer>
  );
}

function SummaryCard({
  summary,
  month,
  config,
  t,
}: {
  summary: NonNullable<ReturnType<typeof useStudentAttendanceSummary>['data']>;
  month: string;
  config: ReturnType<typeof useRegionConfig>;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  // "0%" for an unmarked month reads as "never came" — show a dash instead.
  const noData =
    summary.attendance_percentage === null ||
    summary.present_days + summary.absent_days + summary.late_days + summary.leave_days === 0;

  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-10">
        <div className="md:w-56 md:shrink-0">
          <h2 className="text-label text-text-secondary">
            {t('attendance.summary.rateFor', { month: formatMonth(month, config) })}
          </h2>
          <p className="mt-1 text-display tabular-nums">
            {noData ? '—' : `${formatNumber(summary.attendance_percentage, config)}%`}
          </p>
          {noData && (
            <p className="mt-0.5 text-text-secondary">{t('attendance.summary.notEnoughData')}</p>
          )}
        </div>
        <dl className="grid flex-1 grid-cols-2 gap-4 border-t border-border-subtle pt-4 md:grid-cols-4 md:border-t-0 md:border-l md:pt-0 md:pl-10">
          <SummaryFigure
            label={t('attendance.summary.present')}
            value={summary.present_days}
            dot="bg-status-paid-fg"
            config={config}
          />
          <SummaryFigure
            label={t('attendance.summary.absent')}
            value={summary.absent_days}
            dot="bg-status-overdue-fg"
            config={config}
          />
          <SummaryFigure
            label={t('attendance.summary.late')}
            value={summary.late_days}
            dot="bg-status-due-fg"
            config={config}
          />
          <SummaryFigure
            label={t('attendance.summary.leave')}
            value={summary.leave_days}
            dot="bg-status-partial-fg"
            config={config}
          />
        </dl>
      </div>
    </Card>
  );
}

function SummaryFigure({
  label,
  value,
  dot,
  config,
}: {
  label: string;
  value: number;
  dot: string;
  config: ReturnType<typeof useRegionConfig>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="flex items-center gap-1.5 text-caption text-text-secondary">
        <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
        {label}
      </dt>
      <dd className="text-h2 tabular-nums">{formatNumber(value, config)}</dd>
    </div>
  );
}

/** The selected day's details, next to the grid — replaces the old dialog.
 * Without a day it names the month and says to pick one. */
function AttendanceDayPanel({ day, month }: { day: AttendanceDayCell | null; month: string }) {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  // Seven literal keys, indexed by weekday — a computed key would be
  // invisible to `check-i18n-keys.mjs`.
  const weekdays = [
    t('attendanceGrid.weekdays.0'),
    t('attendanceGrid.weekdays.1'),
    t('attendanceGrid.weekdays.2'),
    t('attendanceGrid.weekdays.3'),
    t('attendanceGrid.weekdays.4'),
    t('attendanceGrid.weekdays.5'),
    t('attendanceGrid.weekdays.6'),
  ];

  let body: React.ReactNode;
  if (day === null) {
    body = (
      <>
        <h2 id="attendance-day-title" className="text-h3">
          {formatMonth(month, config)}
        </h2>
        <p className="text-text-secondary">{t('attendance.pickDay')}</p>
      </>
    );
  } else {
    const { tone, label } = !day.isWorkingDay
      ? { tone: 'neutral' as const, label: t('attendanceGrid.status.notSchoolDay') }
      : day.status === AttendanceStatus.PRESENT
        ? { tone: 'success' as const, label: t('attendanceGrid.status.present') }
        : day.status === AttendanceStatus.LATE
          ? { tone: 'warning' as const, label: t('attendanceGrid.status.late') }
          : day.status === AttendanceStatus.ABSENT
            ? { tone: 'danger' as const, label: t('attendanceGrid.status.absent') }
            : day.status === AttendanceStatus.LEAVE
              ? { tone: 'info' as const, label: t('attendanceGrid.status.leave') }
              : { tone: 'neutral' as const, label: t('attendanceGrid.status.notMarked') };

    body = (
      <>
        <h2 id="attendance-day-title" className="text-h3">
          {formatDate(parseServerDate(day.date), config)}
        </h2>
        <p className="text-text-secondary">{weekdays[parseServerDate(day.date).getDay()]}</p>
        <dl className="mt-3 divide-y divide-border-subtle border-t border-border-subtle">
          <div className="flex items-center justify-between gap-3 py-3">
            <dt className="text-text-secondary">{t('attendance.dialog.statusLabel')}</dt>
            <dd>
              <StatusBadge tone={tone} label={label} />
            </dd>
          </div>
          {day.status === AttendanceStatus.LATE && day.minutesLate != null && (
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-text-secondary">{t('attendance.dialog.minutesLateLabel')}</dt>
              <dd className="font-medium tabular-nums">{formatNumber(day.minutesLate, config)}</dd>
            </div>
          )}
          {day.remarks && (
            <div className="py-3">
              <dt className="text-text-secondary">{t('attendance.dialog.remarksLabel')}</dt>
              <dd className="mt-0.5">{day.remarks}</dd>
            </div>
          )}
          {!day.isWorkingDay && day.holidayName && (
            <div className="py-3">
              <dt className="text-text-secondary">{t('attendance.dialog.holidayLabel')}</dt>
              <dd className="mt-0.5">{day.holidayName}</dd>
            </div>
          )}
        </dl>
      </>
    );
  }

  return (
    <Card asChild>
      <aside className="p-4 md:w-80 md:shrink-0 md:p-5" aria-labelledby="attendance-day-title">
        {body}
      </aside>
    </Card>
  );
}

function AttendanceSkeleton({
  label,
  showPicker = false,
}: {
  label: string;
  showPicker?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-2/5" />
      {showPicker && <Skeleton className="h-12 w-full rounded-lg" />}
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}

function PortalAttendancePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
