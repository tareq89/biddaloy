/**
 * [9.9] The one shared month-grid — today only the guardian portal's
 * per-child attendance view (`client-admin/src/routes/portal/attendance.tsx`)
 * calls it, but it is deliberately domain-general (a plain `AttendanceDayCell`
 * per day, not a `StudentAttendanceDay` API shape) so a future staff-facing
 * calendar can reuse it without a rewrite.
 *
 * Six visual states, each an icon *and* a word — never colour alone, same
 * rule `attendance-status-control.tsx` follows and the same tone tokens
 * (`status-badge.tsx`'s `status-*` pairs) so a PRESENT day here and a
 * PRESENT pill on the marking screen read as the same fact:
 *
 *   Present        — `status === 'PRESENT'`
 *   Late           — `status === 'LATE'` (label includes minutes when known)
 *   Absent         — `status === 'ABSENT'`
 *   Leave          — `status === 'LEAVE'`
 *   Not school day — `isWorkingDay === false` (holiday name in a tooltip)
 *   Not marked     — a working day with `status === null`
 *
 * A real `<table>`, not a CSS grid of `<div>`s — this is genuinely tabular
 * data (one row per week, one column per weekday) and a screen reader
 * should be able to say "row 2, column Wednesday" the way it does for any
 * other table, which only a real `<table>`/`<th scope="col">` structure
 * gives for free.
 *
 * `days` is trusted to be short or missing entries without crashing: any
 * day of the month absent from the array renders as "Not marked" rather
 * than a blank cell or a thrown error — the API always sends one entry per
 * calendar day, but a component this reusable shouldn't assume its caller
 * always will.
 *
 * `firstDayOfWeek` rotates BOTH the weekday header row AND the leading-blank
 * calculation. Getting only one of the two would silently misalign the grid
 * for half the year — `attendance-month-grid.test.tsx` asserts both against
 * a real February.
 */
import { AttendanceStatus } from '@biddaloy/shared';
import { Ban, Calendar, Check, Clock, Minus, X, type LucideIcon } from 'lucide-react';

import { useRegionConfig, useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';
import { formatDate, parseServerDate } from '../utils';

import { Skeleton } from './skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

/** One calendar day this grid renders — deliberately not the API's
 * `StudentAttendanceDay` shape (snake_case, server field names); the
 * caller maps its query response into this before handing it down, which
 * is what keeps this component reusable by a future non-attendance-API
 * caller too. */
export interface AttendanceDayCell {
  /** `YYYY-MM-DD`. */
  date: string;
  /** `null` = not marked. */
  status: AttendanceStatus | null;
  isWorkingDay: boolean;
  holidayName?: string | null;
  minutesLate?: number | null;
  remarks?: string | null;
}

export interface AttendanceMonthGridProps {
  /** `YYYY-MM`. */
  month: string;
  days: readonly AttendanceDayCell[];
  /** 0 (Sunday) – 6 (Saturday). Defaults to 0 — `RegionDateSettings`'s own
   * default (`region-config.ts`). */
  firstDayOfWeek?: number;
  isLoading?: boolean;
  onSelectDay?: (day: AttendanceDayCell) => void;
  className?: string;
}

type CellState = 'present' | 'late' | 'absent' | 'leave' | 'notSchoolDay' | 'notMarked';

const STATE_ICON: Record<CellState, LucideIcon> = {
  present: Check,
  late: Clock,
  absent: X,
  leave: Calendar,
  notSchoolDay: Ban,
  notMarked: Minus,
};

/** Same four tones `attendance-status-control.tsx`'s `STATUS_TONE_CLASSES`
 * uses, plus the two states that control doesn't have (a mark is either
 * one of the four statuses or unset — this grid also has "not a school
 * day" and, unlike that control, renders "not marked" as a first-class
 * visible state rather than an empty pill). */
const STATE_TONE_CLASSES: Record<CellState, string> = {
  present: 'text-status-paid-fg bg-status-paid-bg',
  absent: 'text-status-overdue-fg bg-status-overdue-bg',
  late: 'text-status-due-fg bg-status-due-bg',
  leave: 'text-status-partial-fg bg-status-partial-bg',
  notSchoolDay: 'text-muted-foreground bg-muted',
  notMarked: 'text-muted-foreground bg-transparent border border-dashed border-border-subtle',
};

function stateOf(day: AttendanceDayCell): CellState {
  if (!day.isWorkingDay) return 'notSchoolDay';
  switch (day.status) {
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

/** Literal per-state lookup, not `t(\`attendanceGrid.status.${state}\`)` —
 * a computed key is invisible to `check-i18n-keys.mjs` (same reasoning
 * `portal/fees.tsx`'s `useMonthNames` documents). */
function stateLabel(t: ReturnType<typeof useTranslation>['t'], state: CellState) {
  switch (state) {
    case 'present':
      return t('attendanceGrid.status.present');
    case 'late':
      return t('attendanceGrid.status.late');
    case 'absent':
      return t('attendanceGrid.status.absent');
    case 'leave':
      return t('attendanceGrid.status.leave');
    case 'notSchoolDay':
      return t('attendanceGrid.status.notSchoolDay');
    case 'notMarked':
      return t('attendanceGrid.status.notMarked');
  }
}

const MONTH_KEYS = [
  'attendanceGrid.months.1',
  'attendanceGrid.months.2',
  'attendanceGrid.months.3',
  'attendanceGrid.months.4',
  'attendanceGrid.months.5',
  'attendanceGrid.months.6',
  'attendanceGrid.months.7',
  'attendanceGrid.months.8',
  'attendanceGrid.months.9',
  'attendanceGrid.months.10',
  'attendanceGrid.months.11',
  'attendanceGrid.months.12',
] as const;

const WEEKDAY_KEYS = [
  'attendanceGrid.weekdays.0',
  'attendanceGrid.weekdays.1',
  'attendanceGrid.weekdays.2',
  'attendanceGrid.weekdays.3',
  'attendanceGrid.weekdays.4',
  'attendanceGrid.weekdays.5',
  'attendanceGrid.weekdays.6',
] as const;

interface GridDay {
  date: string;
  dayOfMonth: number;
  cell: AttendanceDayCell;
}

/** `Date.UTC` arithmetic throughout — never a local-timezone `Date` — same
 * rule `resolveDateRange` (`attendance-summary.dto.ts`) follows server-side,
 * so a browser in a non-Dhaka timezone still computes the same grid. */
function buildGridDays(month: string, days: readonly AttendanceDayCell[]): GridDay[] {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const byDate = new Map(days.map((day) => [day.date, day]));

  const result: GridDay[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${yearStr}-${monthStr}-${String(d).padStart(2, '0')}`;
    const cell = byDate.get(date) ?? {
      date,
      status: null,
      isWorkingDay: true,
      holidayName: null,
      minutesLate: null,
      remarks: null,
    };
    result.push({ date, dayOfMonth: d, cell });
  }
  return result;
}

function firstWeekdayOfMonth(month: string): number {
  const [yearStr, monthStr] = month.split('-');
  return new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1)).getUTCDay();
}

export function AttendanceMonthGrid({
  month,
  days,
  firstDayOfWeek = 0,
  isLoading = false,
  onSelectDay,
  className,
}: AttendanceMonthGridProps) {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();

  const [yearStr, monthStr] = month.split('-');
  const monthIndex = Number(monthStr) - 1;
  const caption = t('attendanceGrid.caption', {
    month: t(MONTH_KEYS[monthIndex] ?? MONTH_KEYS[0]),
    year: yearStr,
  });

  const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
    t(WEEKDAY_KEYS[(firstDayOfWeek + i) % 7] ?? WEEKDAY_KEYS[0]),
  );

  if (isLoading) {
    return (
      <div className={cn('flex flex-col gap-3', className)}>
        {/* `table-fixed` forces all 7 columns to share the table's own
         * `w-full` width equally, regardless of content — without it, a
         * fixed-size day cell keeps its intrinsic width and the table (and
         * the whole page) overflows a 320px viewport instead of shrinking
         * the cells (WCAG 1.4.10 reflow, [9.9 fix]). */}
        <table className="w-full table-fixed border-collapse" aria-hidden="true">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {weekdayLabels.map((label, i) => (
                <th key={i} scope="col" className="p-1 text-center text-xs text-muted-foreground">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, row) => (
              <tr key={row}>
                {Array.from({ length: 7 }, (_, col) => (
                  <td key={col} className="p-1">
                    <Skeleton className="mx-auto aspect-square w-full max-w-10 rounded-md" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <span className="sr-only" aria-live="polite">
          {t('attendanceGrid.loading')}
        </span>
      </div>
    );
  }

  const gridDays = buildGridDays(month, days);
  const leadingBlanks = (((firstWeekdayOfMonth(month) - firstDayOfWeek) % 7) + 7) % 7;

  const cells: (GridDay | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...gridDays,
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (GridDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <TooltipProvider>
      <div className={cn('flex flex-col gap-3', className)}>
        {/* `table-fixed` — see the loading table's comment above; same
         * reflow constraint applies here. */}
        <table className="w-full table-fixed border-collapse">
          <caption className="pb-2 text-start text-sm font-semibold">{caption}</caption>
          <thead>
            <tr>
              {weekdayLabels.map((label, i) => (
                <th key={i} scope="col" className="p-1 text-center text-xs text-muted-foreground">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((gridDay, colIndex) => {
                  if (gridDay === null) {
                    return <td key={colIndex} aria-hidden="true" className="p-1" />;
                  }

                  const state = stateOf(gridDay.cell);
                  const Icon = STATE_ICON[state];
                  const toneClasses = STATE_TONE_CLASSES[state];
                  const label = stateLabel(t, state);
                  const lateLabel =
                    state === 'late' && gridDay.cell.minutesLate != null
                      ? t('attendanceGrid.lateWithMinutes', { minutes: gridDay.cell.minutesLate })
                      : label;
                  const accessibleDate = formatDate(parseServerDate(gridDay.date), config);
                  const accessibleLabel = `${accessibleDate} — ${lateLabel}`;

                  const content = (
                    <div
                      className={cn(
                        'mx-auto flex aspect-square w-full max-w-10 flex-col items-center justify-center gap-0.5 rounded-md text-xs',
                        toneClasses,
                      )}
                    >
                      <span aria-hidden="true" className="font-semibold">
                        {gridDay.dayOfMonth}
                      </span>
                      <Icon aria-hidden="true" className="size-3" />
                      <span className="sr-only">{lateLabel}</span>
                    </div>
                  );

                  const wrapped =
                    state === 'notSchoolDay' && gridDay.cell.holidayName ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          {onSelectDay ? (
                            <button
                              type="button"
                              aria-label={`${accessibleLabel} — ${gridDay.cell.holidayName}`}
                              onClick={() => onSelectDay(gridDay.cell)}
                              className="rounded-md"
                            >
                              {content}
                            </button>
                          ) : (
                            <div aria-label={`${accessibleLabel} — ${gridDay.cell.holidayName}`}>
                              {content}
                            </div>
                          )}
                        </TooltipTrigger>
                        <TooltipContent>{gridDay.cell.holidayName}</TooltipContent>
                      </Tooltip>
                    ) : onSelectDay ? (
                      <button
                        type="button"
                        aria-label={accessibleLabel}
                        onClick={() => onSelectDay(gridDay.cell)}
                        className="rounded-md"
                      >
                        {content}
                      </button>
                    ) : (
                      <div aria-label={accessibleLabel}>{content}</div>
                    );

                  return (
                    <td key={colIndex} className="p-1 text-center">
                      {wrapped}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <Legend t={t} />
      </div>
    </TooltipProvider>
  );
}

const LEGEND_STATES: CellState[] = [
  'present',
  'late',
  'absent',
  'leave',
  'notSchoolDay',
  'notMarked',
];

function Legend({ t }: { t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold text-muted-foreground">
        {t('attendanceGrid.legendTitle')}
      </h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {LEGEND_STATES.map((state) => {
          const Icon = STATE_ICON[state];
          return (
            <li key={state} className="flex items-center gap-1.5 text-xs">
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-md',
                  STATE_TONE_CLASSES[state],
                )}
              >
                <Icon aria-hidden="true" className="size-3" />
              </span>
              <span>{stateLabel(t, state)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
