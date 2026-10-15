/**
 * [8.10.7.5.09] Portal overview month card: the picked child's attendance grid
 * (`AttendanceMonthGrid`, which already pairs every state with an icon and a
 * word, so it never relies on colour) plus a one-line summary counted over the
 * school days up to the school's `today`. The child switch is local state in
 * the page, not a URL param, so the chips are buttons rather than the
 * Link-based `StudentPicker`.
 */
import { AttendanceStatus } from '@biddaloy/shared';
import { AttendanceMonthGrid, WidgetCard, type AttendanceDayCell } from '@biddaloy/ui/components';
import { useStudentAttendanceDays } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';

const MAX_MISSED_DATES = 3;

export interface HeatmapChild {
  id: string;
  fullName: string;
}

export function AttendanceHeatmapCard({
  students,
  selectedId,
  onSelect,
  today,
  month,
}: {
  students: HeatmapChild[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** The school's today, `YYYY-MM-DD`. */
  today: string;
  /** `YYYY-MM`. */
  month: string;
}) {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const query = useStudentAttendanceDays(selectedId, month);

  const days: AttendanceDayCell[] = (query.data ?? []).map((day) => ({
    date: day.date,
    status: day.status,
    isWorkingDay: day.is_working_day,
    holidayName: day.holiday_name,
    minutesLate: day.minutes_late,
    remarks: day.remarks,
  }));

  // School days so far; "present" counts LATE too, "missed" is everything else.
  const soFar = days.filter((day) => day.isWorkingDay && day.date <= today);
  const isPresent = (day: AttendanceDayCell) =>
    day.status === AttendanceStatus.PRESENT || day.status === AttendanceStatus.LATE;
  const present = soFar.filter(isPresent).length;
  const missed = soFar.filter((day) => !isPresent(day));
  const dates = missed.slice(0, MAX_MISSED_DATES).map((day) => formatDate(day.date, config));
  if (missed.length > MAX_MISSED_DATES) dates.push('…');

  const summary =
    soFar.length === 0
      ? t('heatmap.summaryNone')
      : missed.length === 0
        ? t('heatmap.summaryAll', { total: soFar.length })
        : t('heatmap.summarySome', {
            present,
            total: soFar.length,
            dates: dates.join(', '),
          });
  const value = t('heatmap.value', { count: present });
  const link = (
    <Link
      to="/portal/attendance"
      search={{ student: selectedId, month }}
      className="inline-flex min-h-11 items-center text-primary underline md:min-h-6"
    >
      {t('heatmap.link')}
    </Link>
  );

  // Outside the card so it stays put while the other child's month loads.
  const picker =
    students.length > 1 ? (
      <div role="group" aria-label={t('heatmap.childPicker')} className="flex flex-wrap gap-2">
        {students.map((child) => (
          <button
            key={child.id}
            type="button"
            aria-pressed={child.id === selectedId}
            onClick={() => onSelect(child.id)}
            className={`min-h-11 rounded-lg border px-3 font-semibold ${
              child.id === selectedId
                ? 'border-primary bg-secondary'
                : 'border-border-subtle bg-surface hover:bg-muted'
            }`}
          >
            {child.fullName}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-3">
      {picker}
      <WidgetCard
        title={t('heatmap.title')}
        loading={query.isPending}
        loadingLabel={t('heatmap.title')}
        {...(query.isError
          ? {
              error: {
                message: t('error.message'),
                retryLabel: t('error.retry'),
                onRetry: () => void query.refetch(),
              },
            }
          : {})}
        value={value}
        unit={t('heatmap.valueUnit')}
        summary={summary}
        footer={link}
      >
        <AttendanceMonthGrid
          month={month}
          days={days}
          firstDayOfWeek={config.date.firstDayOfWeek}
          today={today}
        />
      </WidgetCard>
    </div>
  );
}
