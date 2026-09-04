/**
 * [9.10] "Attendance" tab on the student detail page — a staff-facing
 * mirror of [9.9]'s guardian-portal month grid, over the same [9.4]
 * endpoints (`GET /attendance/students/:studentId/{days,summary}`).
 * Reuses `AttendanceMonthGrid` ([9.9]) wholesale rather than building a
 * second grid — see this ticket's own plan on why that's a hard
 * constraint, not a preference. The month stepper is local `useState`,
 * not a URL param the way `portal/attendance.tsx` uses one: this is one
 * tab of eight on a page that already owns `?tab=`, and stacking a second
 * URL-controlled dimension onto the same search string is `portal/
 * attendance.tsx`'s job (a full page, no competing tab state), not this
 * one's.
 */
import { AttendanceMonthGrid, Card, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useStudentAttendanceDays, useStudentAttendanceSummary } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { renderDigits } from '@biddaloy/ui/utils';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import * as React from 'react';

export interface AttendanceTabProps {
  studentId: string;
}

function currentMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Same UTC-anchored arithmetic as `portal/attendance.tsx`'s own
 * `shiftMonth` — never a local-timezone `Date`, so a month step near a
 * DST boundary can't skip or repeat a month. */
function shiftMonth(month: string, delta: number): string {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const shifted = new Date(Date.UTC(year, monthNum - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function AttendanceTab({ studentId }: AttendanceTabProps) {
  const { t } = useTranslation('students');
  const config = useRegionConfig();
  const [month, setMonth] = React.useState(currentMonthIso());

  const daysQuery = useStudentAttendanceDays(studentId, month);
  const summaryQuery = useStudentAttendanceSummary(studentId, month);

  if (daysQuery.isPending || summaryQuery.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t('detail.attendanceTab.loading')}</span>
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    );
  }

  if (daysQuery.isError || summaryQuery.isError) {
    return (
      <ErrorState
        message={t('detail.attendanceTab.errorMessage')}
        retryLabel={t('actions.retry', { ns: 'common' })}
        onRetry={() => {
          void daysQuery.refetch();
          void summaryQuery.refetch();
        }}
      />
    );
  }

  const days = daysQuery.data.map((day) => ({
    date: day.date,
    status: day.status,
    isWorkingDay: day.is_working_day,
    holidayName: day.holiday_name,
    minutesLate: day.minutes_late,
    remarks: day.remarks,
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMonth((current) => shiftMonth(current, -1))}
          aria-label={t('detail.attendanceTab.monthStepper.previousLabel')}
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <ChevronLeftIcon className="size-5" aria-hidden="true" />
        </button>
        <span className="text-sm font-semibold">{month}</span>
        <button
          type="button"
          onClick={() => setMonth((current) => shiftMonth(current, 1))}
          aria-label={t('detail.attendanceTab.monthStepper.nextLabel')}
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <ChevronRightIcon className="size-5" aria-hidden="true" />
        </button>
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-normal text-muted-foreground">
            {t('detail.attendanceTab.summary.percentage')}
          </h2>
          {summaryQuery.data.attendance_percentage === null ? (
            <>
              <div className="text-3xl leading-tight font-bold tabular-nums">{'—'}</div>
              <div className="text-xs text-muted-foreground">
                {t('detail.attendanceTab.summary.notEnoughData')}
              </div>
            </>
          ) : (
            <div className="text-3xl leading-tight font-bold tabular-nums">
              {renderDigits(`${summaryQuery.data.attendance_percentage}%`, config.numerals)}
            </div>
          )}
        </div>
        <dl className="grid grid-cols-4 gap-2 border-t border-border-subtle pt-3">
          <SummaryFigure
            label={t('detail.attendanceTab.summary.present')}
            value={summaryQuery.data.present_days}
          />
          <SummaryFigure
            label={t('detail.attendanceTab.summary.absent')}
            value={summaryQuery.data.absent_days}
          />
          <SummaryFigure
            label={t('detail.attendanceTab.summary.late')}
            value={summaryQuery.data.late_days}
          />
          <SummaryFigure
            label={t('detail.attendanceTab.summary.leave')}
            value={summaryQuery.data.leave_days}
          />
        </dl>
      </Card>

      {days.length === 0 ? (
        <Card className="p-3.5">
          <p className="text-sm text-muted-foreground">
            {t('detail.attendanceTab.noRecordsThisMonth')}
          </p>
        </Card>
      ) : (
        <Card className="p-3.5">
          <AttendanceMonthGrid
            month={month}
            days={days}
            firstDayOfWeek={config.date.firstDayOfWeek}
          />
        </Card>
      )}
    </div>
  );
}

function SummaryFigure({ label, value }: { label: string; value: number }) {
  const config = useRegionConfig();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">
        {renderDigits(String(value), config.numerals)}
      </dd>
    </div>
  );
}
