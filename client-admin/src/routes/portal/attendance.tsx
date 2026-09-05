import { AttendanceStatus } from '@biddaloy/shared';
import {
  AttendanceMonthGrid,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  RoutePending,
  Skeleton,
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
import { formatDate, parseServerDate, renderDigits } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
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

function shiftMonth(month: string, delta: number): string {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const shifted = new Date(Date.UTC(year, monthNum - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
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

/** Twelve literal `t()` calls, not a computed `t(\`attendanceGrid.months.${n}\`)`
 * — a computed key is invisible to `check-i18n-keys.mjs`, same reasoning
 * `fees.tsx`'s `useMonthNames` documents. Reuses `AttendanceMonthGrid`'s
 * own `attendanceGrid.months.*` keys rather than a second copy, since this
 * route's month caption names the exact same month the grid below it
 * renders. */
function useMonthNames(): string[] {
  const { t } = useTranslation('portal');
  return [
    t('attendanceGrid.months.1'),
    t('attendanceGrid.months.2'),
    t('attendanceGrid.months.3'),
    t('attendanceGrid.months.4'),
    t('attendanceGrid.months.5'),
    t('attendanceGrid.months.6'),
    t('attendanceGrid.months.7'),
    t('attendanceGrid.months.8'),
    t('attendanceGrid.months.9'),
    t('attendanceGrid.months.10'),
    t('attendanceGrid.months.11'),
    t('attendanceGrid.months.12'),
  ];
}

function monthCaption(month: string, monthNames: string[]): string {
  const [yearStr, monthStr] = month.split('-');
  const monthNum = Number(monthStr);
  return `${monthNames[monthNum - 1] ?? monthStr} ${yearStr}`;
}

/** The same "class section · roll" line `portal/index.tsx` and
 * `fees.tsx` render, from the same two keys. */
function useStudentMeta(): (student: Student) => string {
  const { t } = useTranslation('portal');
  return (student: Student) => {
    const className = student.class_section?.class?.name ?? null;
    return className === null
      ? t('children.metaNoClass', { roll: student.roll_number })
      : t('children.meta', {
          className,
          section: student.class_section?.section_name ?? '',
          roll: student.roll_number,
        });
  };
}

function PortalAttendance() {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const search = Route.useSearch();
  const studentMeta = useStudentMeta();
  const monthNames = useMonthNames();
  const [selectedDay, setSelectedDay] = React.useState<AttendanceDayCell | null>(null);

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
      <EmptyState
        title={t('empty.title')}
        explanation={t('empty.explanation')}
        action={{ label: t('empty.action'), onClick: () => void studentsQuery.refetch() }}
      />
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

  const previousMonth = shiftMonth(search.month, -1);
  const nextMonth = shiftMonth(search.month, 1);

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h1 className="text-lg font-semibold tracking-tight">{t('attendance.title')}</h1>
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
      <div className="flex items-center justify-between gap-2">
        <Link
          to="/portal/attendance"
          search={{ student: selected.id, month: previousMonth }}
          aria-label={t('attendance.monthStepper.previousLabel', {
            month: monthCaption(previousMonth, monthNames),
          })}
          className="flex size-11 items-center justify-center rounded-md text-muted-foreground"
        >
          <ChevronLeftIcon className="size-5" aria-hidden="true" />
        </Link>
        <span className="text-sm font-semibold" aria-hidden="true">
          {monthCaption(search.month, monthNames)}
        </span>
        <Link
          to="/portal/attendance"
          search={{ student: selected.id, month: nextMonth }}
          aria-label={t('attendance.monthStepper.nextLabel', {
            month: monthCaption(nextMonth, monthNames),
          })}
          className="flex size-11 items-center justify-center rounded-md text-muted-foreground"
        >
          <ChevronRightIcon className="size-5" aria-hidden="true" />
        </Link>
      </div>
      <SummaryCard summary={summaryQuery.data} config={config} t={t} />
      {days.length === 0 ? (
        <Card className="p-3.5">
          <p className="text-sm text-muted-foreground">{t('attendance.noRecordsThisMonth')}</p>
        </Card>
      ) : (
        <Card className="p-3.5">
          <AttendanceMonthGrid
            month={search.month}
            days={days}
            firstDayOfWeek={config.date.firstDayOfWeek}
            onSelectDay={setSelectedDay}
          />
        </Card>
      )}
      <DayDialog day={selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)} />
    </div>
  );
}

function SummaryCard({
  summary,
  config,
  t,
}: {
  summary: NonNullable<ReturnType<typeof useStudentAttendanceSummary>['data']>;
  config: ReturnType<typeof useRegionConfig>;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-normal text-muted-foreground">
          {t('attendance.summary.percentage')}
        </h2>
        {summary.attendance_percentage === null ? (
          <>
            <div className="text-3xl leading-tight font-bold tabular-nums">{'—'}</div>
            <div className="text-xs text-muted-foreground">
              {t('attendance.summary.notEnoughData')}
            </div>
          </>
        ) : (
          <div className="text-3xl leading-tight font-bold tabular-nums">
            {renderDigits(`${summary.attendance_percentage}%`, config.numerals)}
          </div>
        )}
      </div>
      <dl className="grid grid-cols-4 gap-2 border-t border-border-subtle pt-3">
        <SummaryFigure
          label={t('attendance.summary.present')}
          value={summary.present_days}
          config={config}
        />
        <SummaryFigure
          label={t('attendance.summary.absent')}
          value={summary.absent_days}
          config={config}
        />
        <SummaryFigure
          label={t('attendance.summary.late')}
          value={summary.late_days}
          config={config}
        />
        <SummaryFigure
          label={t('attendance.summary.leave')}
          value={summary.leave_days}
          config={config}
        />
      </dl>
    </Card>
  );
}

function SummaryFigure({
  label,
  value,
  config,
}: {
  label: string;
  value: number;
  config: ReturnType<typeof useRegionConfig>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">
        {renderDigits(String(value), config.numerals)}
      </dd>
    </div>
  );
}

function DayDialog({
  day,
  onOpenChange,
}: {
  day: AttendanceDayCell | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();

  if (day === null) return null;

  const statusKey = !day.isWorkingDay
    ? 'attendanceGrid.status.notSchoolDay'
    : day.status === AttendanceStatus.PRESENT
      ? 'attendanceGrid.status.present'
      : day.status === AttendanceStatus.LATE
        ? 'attendanceGrid.status.late'
        : day.status === AttendanceStatus.ABSENT
          ? 'attendanceGrid.status.absent'
          : day.status === AttendanceStatus.LEAVE
            ? 'attendanceGrid.status.leave'
            : 'attendanceGrid.status.notMarked';

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{formatDate(parseServerDate(day.date), config)}</DialogTitle>
        </DialogHeader>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('attendance.dialog.statusLabel')}</dt>
            <dd className="font-medium">{t(statusKey)}</dd>
          </div>
          {day.status === AttendanceStatus.LATE && day.minutesLate != null && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t('attendance.dialog.minutesLateLabel')}</dt>
              <dd className="font-medium tabular-nums">
                {renderDigits(String(day.minutesLate), config.numerals)}
              </dd>
            </div>
          )}
          {day.remarks && (
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">{t('attendance.dialog.remarksLabel')}</dt>
              <dd>{day.remarks}</dd>
            </div>
          )}
          {!day.isWorkingDay && day.holidayName && (
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">{t('attendance.dialog.statusLabel')}</dt>
              <dd>{day.holidayName}</dd>
            </div>
          )}
        </dl>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t('attendance.dialog.close')}
        </Button>
      </DialogContent>
    </Dialog>
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
    <div className="flex max-w-2xl flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-7 w-2/5" />
      {showPicker && <Skeleton className="h-12 w-full rounded-lg" />}
      <Skeleton className="h-9 w-full rounded-lg" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}

function PortalAttendancePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
