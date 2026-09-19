import type { CalendarEventType } from '@biddaloy/shared';
import * as React from 'react';

import { EventTypeBadge } from './event-type-badge';

export interface MonthGridEvent {
  id: string;
  type: CalendarEventType;
  typeLabel: string;
  name: string;
  /** Inclusive `YYYY-MM-DD` range — the grid renders one chip per day the
   * event spans, so a multi-day event shows across every cell it covers. */
  startDate: string;
  endDate: string;
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
}: MonthGridProps) {
  const days = React.useMemo(() => buildDays(month, firstDayOfWeek), [month, firstDayOfWeek]);
  const [focusedDay, setFocusedDay] = React.useState<string>(days[0] ?? month);

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
    <div data-testid="month-grid" role="grid" aria-label={month} className="w-full">
      {terms.length > 0 && (
        <div className="mb-1 flex gap-1 text-xs text-muted-foreground" data-testid="term-bands">
          {terms.map((term) => (
            <span key={term.id} className="rounded bg-muted px-2 py-0.5">
              {term.name}
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-7 border-b text-xs font-medium text-muted-foreground">
        {orderedWeekdayLabels.map((label, i) => (
          <div
            key={label}
            className="px-2 py-1 text-center"
            data-weekly-off={weeklyOffDays.includes((firstDayOfWeek + i) % 7) || undefined}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayOfWeek = toDateOnly(day).getUTCDay();
          const isWeekend = weeklyOffDays.includes(dayOfWeek);
          const isCurrentMonth = day.slice(0, 7) === month;
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
              aria-current={day === focusedDay ? 'date' : undefined}
              aria-label={term ? `${day} (${term.name})` : day}
              onFocus={() => setFocusedDay(day)}
              onKeyDown={(event) => handleKeyDown(event, day)}
              onClick={() => {
                setFocusedDay(day);
                onDayClick?.(day);
              }}
              className={[
                'min-h-24 border-r border-b p-1 text-start align-top',
                isWeekend ? 'bg-muted/40' : 'bg-background',
                isCurrentMonth ? '' : 'text-muted-foreground/50',
              ].join(' ')}
            >
              <span className="text-xs font-medium">{Number(day.slice(8, 10))}</span>
              <div className="mt-1 flex flex-col gap-0.5">
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
                      className="w-full truncate"
                    />
                  </button>
                ))}
                {overflowCount > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {moreLabel(overflowCount)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
