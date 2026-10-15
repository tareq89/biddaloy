/**
 * [8.10.7.5.09] "Today" strip on the portal overview: each child's attendance
 * today, from `GET /attendance/students/:id/days?month=` (the heatmap card asks
 * for the same month, so the query is shared). `today` and `month` are the
 * school's date. No heading element: the page `h1` rules in `index.tsx` forbid
 * one, so the strip is a labelled region.
 *
 * Desktop: one card per child. Phone: one card, one row per child. Both are
 * mounted and switched by CSS; they share the per-child query.
 */
import { AttendanceStatus } from '@biddaloy/shared';
import { Card, Skeleton, StatusBadge } from '@biddaloy/ui/components';
import type { StatusTone } from '@biddaloy/ui/components';
import { useStudentAttendanceDays, type StudentAttendanceDay } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatTime } from '@biddaloy/ui/utils';
import { Ban, Calendar, Check, Clock, Minus, X, type LucideIcon } from 'lucide-react';

export interface TodayStripChild {
  id: string;
  fullName: string;
  meta: string;
}

type TodayState = 'closed' | 'present' | 'late' | 'absent' | 'leave' | 'notMarked';

/** Same tone pairs `attendance-month-grid.tsx` uses, so a PRESENT day here and
 * a PRESENT cell in the grid read as the same fact. Icon and word always
 * accompany the colour. */
const STATE_LOOK: Record<TodayState, { tone: StatusTone; icon: LucideIcon; classes: string }> = {
  closed: { tone: 'neutral', icon: Ban, classes: 'text-muted-foreground bg-muted' },
  present: { tone: 'success', icon: Check, classes: 'text-status-paid-fg bg-status-paid-bg' },
  late: { tone: 'warning', icon: Clock, classes: 'text-status-due-fg bg-status-due-bg' },
  absent: { tone: 'danger', icon: X, classes: 'text-status-overdue-fg bg-status-overdue-bg' },
  leave: { tone: 'info', icon: Calendar, classes: 'text-status-partial-fg bg-status-partial-bg' },
  notMarked: { tone: 'neutral', icon: Minus, classes: 'text-muted-foreground bg-muted' },
};

function stateOf(day: StudentAttendanceDay | undefined): TodayState {
  if (day && !day.is_working_day) return 'closed';
  switch (day?.status) {
    case AttendanceStatus.PRESENT:
      return 'present';
    case AttendanceStatus.LATE:
      return 'late';
    case AttendanceStatus.ABSENT:
      return 'absent';
    case AttendanceStatus.LEAVE:
      return 'leave';
    default:
      return 'notMarked';
  }
}

function useTodayChild(child: TodayStripChild, today: string, month: string) {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const query = useStudentAttendanceDays(child.id, month);
  const day = query.data?.find((d) => d.date === today);
  const state = stateOf(day);
  const long: Record<TodayState, string> = {
    closed: t('today.closed'),
    present: t('today.present'),
    late: t('today.late'),
    absent: t('today.absent'),
    leave: t('today.leave'),
    notMarked: t('today.notMarked'),
  };
  const short: Record<TodayState, string> = {
    closed: t('today.shortClosed'),
    present: t('today.shortPresent'),
    late: t('today.shortLate'),
    absent: t('today.shortAbsent'),
    leave: t('today.shortLeave'),
    notMarked: t('today.shortNotMarked'),
  };
  // The "when was it taken" line only makes sense on a school day.
  const takenLine =
    !day || !day.is_working_day
      ? null
      : day.marked_at
        ? t('today.markedAt', { time: formatTime(new Date(day.marked_at), config) })
        : t('today.notTakenYet');
  return {
    pending: query.isPending,
    state,
    longLabel: long[state],
    shortLabel: short[state],
    takenLine,
  };
}

function initials(fullName: string): string {
  return fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

function ChildCard({
  child,
  today,
  month,
}: {
  child: TodayStripChild;
  today: string;
  month: string;
}) {
  const { pending, state, longLabel, takenLine } = useTodayChild(child, today, month);
  const look = STATE_LOOK[state];
  const Icon = look.icon;
  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground"
        >
          {initials(child.fullName)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{child.fullName}</p>
          <p className="truncate text-caption text-text-secondary">{child.meta}</p>
        </div>
      </div>
      {pending ? (
        <Skeleton className="h-12 w-full rounded-md" />
      ) : (
        <>
          <p className={`flex items-center gap-2 rounded-md p-3 font-medium ${look.classes}`}>
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            {longLabel}
          </p>
          {takenLine ? <p className="text-caption text-text-secondary">{takenLine}</p> : null}
        </>
      )}
    </Card>
  );
}

function ChildRow({
  child,
  today,
  month,
}: {
  child: TodayStripChild;
  today: string;
  month: string;
}) {
  const { pending, state, shortLabel, takenLine } = useTodayChild(child, today, month);
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate font-semibold">{child.fullName}</p>
        {takenLine && !pending ? (
          <p className="text-caption text-text-secondary">{takenLine}</p>
        ) : null}
      </div>
      {pending ? (
        <Skeleton className="h-6 w-20 rounded-full" />
      ) : (
        <StatusBadge tone={STATE_LOOK[state].tone} label={shortLabel} />
      )}
    </li>
  );
}

export function TodayStrip({
  students,
  today,
  month,
}: {
  students: TodayStripChild[];
  today: string;
  month: string;
}) {
  const { t } = useTranslation('portal');
  return (
    <section aria-label={t('today.regionLabel')}>
      <div className="hidden gap-4 md:grid md:grid-cols-2 lg:grid-cols-3" data-testid="today-cards">
        {students.map((child) => (
          <ChildCard key={child.id} child={child} today={today} month={month} />
        ))}
      </div>
      <Card className="p-4 md:hidden" data-testid="today-rows">
        <ul className="divide-y divide-border-subtle">
          {students.map((child) => (
            <ChildRow key={child.id} child={child} today={today} month={month} />
          ))}
        </ul>
      </Card>
    </section>
  );
}
