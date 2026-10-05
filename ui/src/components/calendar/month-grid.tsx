import type { CalendarEventType } from '@biddaloy/shared';
import * as React from 'react';

import { useRegionConfig } from '../../i18n';
import { cn } from '../../primitives/lib/utils';
import { formatDate, formatMonth, toIsoDate } from '../../utils/date';
import { renderDigits } from '../../utils/digits';
import { MonthHeader } from '../month-header';

import { EVENT_DOT_CLASSES, EventTypeBadge } from './event-type-badge';

export interface MonthGridEvent {
  id: string;
  type: CalendarEventType;
  typeLabel: string;
  name: string;
  /** Inclusive `YYYY-MM-DD` range — the grid renders one chip per day the
   * event spans, so a multi-day event shows across every cell it covers. */
  startDate: string;
  endDate: string;
  /** Rendered after the name in `DayPanel` only (no room in a grid cell) — e.g.
   * a neutral "draft" StatusBadge for an unpublished event. */
  badge?: React.ReactNode;
}

export interface MonthGridTermBand {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface MonthGridProps {
  /** `YYYY-MM` — the month being displayed. */
  month: string;
  /** 0 = Sunday .. 6 = Saturday, matching `CalendarSettingsResponseDto.firstDayOfWeek`. */
  firstDayOfWeek: number;
  /** 0-6 day-of-week indices treated as the tenant's weekend. */
  weeklyOffDays: number[];
  events: MonthGridEvent[];
  terms?: MonthGridTermBand[];
  weekdayLabels: string[];
  maxEventsPerCell?: number;
  moreLabel: (count: number) => string;
  onDayClick?: (date: string) => void;
  onEventClick?: (eventId: string) => void;
  /** `YYYY-MM-DD`; default = today. */
  selectedDate?: string;
  /** `YYYY-MM-DD`; default = `toIsoDate(new Date())`. */
  today?: string;
  /** When set, the grid renders its own `MonthHeader` (prev / next / Today). */
  onMonthChange?: (month: string) => void;
}

function toDateOnly(iso: string): Date {
  const parts = iso.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftMonth(month: string, delta: number): string {
  const [y = 0, m = 1] = month.split('-').map(Number);
  return toIso(new Date(Date.UTC(y, m - 1 + delta, 1))).slice(0, 7);
}

/** Builds the 6x7 (or 5x7) cell matrix for `month`, honouring `firstDayOfWeek`. */
function buildDays(month: string, firstDayOfWeek: number): string[] {
  const monthParts = month.split('-').map(Number);
  const year = monthParts[0] ?? 0;
  const mo = monthParts[1] ?? 1;
  const firstOfMonth = new Date(Date.UTC(year, mo - 1, 1));
  const lastOfMonth = new Date(Date.UTC(year, mo, 0));

  const leadOffset = (firstOfMonth.getUTCDay() - firstDayOfWeek + 7) % 7;
  const start = new Date(firstOfMonth);
  start.setUTCDate(start.getUTCDate() - leadOffset);

  const trailOffset = (firstDayOfWeek + 6 - lastOfMonth.getUTCDay() + 7) % 7;
  const end = new Date(lastOfMonth);
  end.setUTCDate(end.getUTCDate() + trailOffset);

  const days: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(toIso(d));
  }
  return days;
}

/** Whether `event`'s inclusive `startDate..endDate` range covers `day`
 * (all `YYYY-MM-DD`, comparable lexically). Exported so other calendar
 * views (e.g. `AgendaList`) group multi-day events onto every day they
 * span, not just their `startDate`. */
export function eventCoversDay(event: MonthGridEvent, day: string): boolean {
  return event.startDate <= day && event.endDate >= day;
}

/**
 * Presentational month grid — pure props in, JSX out, no data hooks (see
 * this ticket's own file-list note: [17.5.2]'s portal calendar page
 * reuses this component as-is). Renders weekend columns shaded, term
 * bands as a header strip, event chips clipped per cell with a "+N more"
 * overflow, and supports arrow-key day-focus navigation for a11y.
 */
export function MonthGrid({
  month,
  firstDayOfWeek,
  weeklyOffDays,
  events,
  terms = [],
  weekdayLabels,
  maxEventsPerCell = 3,
  moreLabel,
  onDayClick,
  onEventClick,
  selectedDate,
  today: todayProp,
  onMonthChange,
}: MonthGridProps) {
  const config = useRegionConfig();
  const today = todayProp ?? toIsoDate(new Date());
  const selected = selectedDate ?? today;
  const days = React.useMemo(() => buildDays(month, firstDayOfWeek), [month, firstDayOfWeek]);
  const [focusedDay, setFocusedDay] = React.useState<string>(
    days.includes(selected) ? selected : days.includes(today) ? today : (days[0] ?? month),
  );

  const orderedWeekdayLabels = React.useMemo(() => {
    const rotated: string[] = [];
    for (let i = 0; i < 7; i++) {
      rotated.push(weekdayLabels[(firstDayOfWeek + i) % 7] ?? '');
    }
    return rotated;
  }, [weekdayLabels, firstDayOfWeek]);

  function moveFocus(offsetDays: number) {
    const idx = days.indexOf(focusedDay);
    const next = days[Math.min(Math.max(idx + offsetDays, 0), days.length - 1)];
    if (next) setFocusedDay(next);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>, day: string) {
    setFocusedDay(day);
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        moveFocus(-1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(7);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-7);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onDayClick?.(day);
        break;
      default:
        break;
    }
  }

  const termForDay = (day: string) =>
    terms.find((term) => term.startDate <= day && term.endDate >= day);

  return (
    <div
      data-testid="month-grid"
      role="grid"
      aria-label={formatMonth(month, config)}
      className="w-full overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1"
    >
      {onMonthChange && (
        <div className="p-3 md:px-4">
          <MonthHeader
            label={formatMonth(month, config)}
            onPrevious={() => onMonthChange(shiftMonth(month, -1))}
            onNext={() => onMonthChange(shiftMonth(month, 1))}
            onToday={() => {
              onMonthChange(today.slice(0, 7));
              onDayClick?.(today);
            }}
          />
        </div>
      )}
      {terms.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2 md:px-4" data-testid="term-bands">
          {terms.map((term) => (
            <span
              key={term.id}
              className="rounded-sm bg-muted px-2 py-0.5 text-caption text-text-secondary"
            >
              {term.name}
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-7 border-t border-border-subtle bg-muted text-center text-label text-text-secondary">
        {orderedWeekdayLabels.map((label, i) => (
          <div
            key={label}
            className="flex h-8 items-center justify-center"
            data-weekly-off={weeklyOffDays.includes((firstDayOfWeek + i) % 7) || undefined}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px border-t border-border-subtle bg-border-subtle">
        {days.map((day) => {
          const dayOfWeek = toDateOnly(day).getUTCDay();
          const isWeekend = weeklyOffDays.includes(dayOfWeek);
          const isCurrentMonth = day.slice(0, 7) === month;
          const isToday = day === today;
          const isSelected = day === selected;
          const dayEvents = events.filter((e) => eventCoversDay(e, day));
          const visibleEvents = dayEvents.slice(0, maxEventsPerCell);
          const overflowCount = dayEvents.length - visibleEvents.length;
          const term = termForDay(day);

          // A `<div role="gridcell">`, not a `<button>`: it hosts one real
          // `<button>` per event chip below, and a button can't nest
          // another interactive button (invalid HTML — the browser would
          // silently close the outer one early). Day-cell activation
          // (click/Enter/Space/arrows) is still fully keyboard-reachable
          // via `tabIndex`/`onKeyDown` on this element itself.
          return (
            <div
              key={day}
              role="gridcell"
              tabIndex={day === focusedDay ? 0 : -1}
              data-testid={`day-cell-${day}`}
              aria-current={isToday ? 'date' : undefined}
              aria-selected={isSelected || undefined}
              aria-label={
                term ? `${formatDate(day, config)} (${term.name})` : formatDate(day, config)
              }
              onFocus={() => setFocusedDay(day)}
              onKeyDown={(event) => handleKeyDown(event, day)}
              onClick={() => {
                setFocusedDay(day);
                onDayClick?.(day);
              }}
              className={cn(
                'flex min-h-12 min-w-0 flex-col items-center gap-1 p-1 text-start md:min-h-24 md:items-stretch md:p-1.5',
                isSelected
                  ? 'bg-secondary'
                  : isWeekend
                    ? 'bg-muted'
                    : isCurrentMonth
                      ? 'bg-surface'
                      : 'bg-bg',
              )}
            >
              <span
                className={cn(
                  'flex size-7 items-center justify-center self-center rounded-full text-label md:self-start',
                  isToday && 'font-semibold text-primary ring-2 ring-primary ring-inset',
                  isSelected && 'bg-primary font-semibold text-primary-foreground ring-0',
                  !isCurrentMonth && 'text-text-secondary opacity-60',
                )}
              >
                {renderDigits(String(Number(day.slice(8, 10))), config.numerals)}
              </span>
              <div className="mt-1 hidden min-w-0 flex-col gap-0.5 md:flex">
                {visibleEvents.map((event) => (
                  <button
                    type="button"
                    key={event.id}
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      onEventClick?.(event.id);
                    }}
                  >
                    <EventTypeBadge
                      type={event.type}
                      label={event.name}
                      className="w-full truncate rounded-sm px-1.5 py-0.5 text-caption"
                    />
                  </button>
                ))}
                {overflowCount > 0 && (
                  <span className="text-caption text-text-secondary">
                    {moreLabel(overflowCount)}
                  </span>
                )}
              </div>
              <div aria-hidden="true" className="flex gap-0.5 md:hidden">
                {dayEvents.slice(0, 3).map((event) => (
                  <span
                    key={event.id}
                    className={cn('size-1.5 rounded-full', EVENT_DOT_CLASSES[event.type])}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
