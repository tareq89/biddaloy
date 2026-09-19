import type { CalendarEventType } from '@biddaloy/shared';
import * as React from 'react';

import { EventTypeBadge } from './event-type-badge';
import { eventCoversDay } from './month-grid';

export interface AgendaEvent {
  id: string;
  type: CalendarEventType;
  typeLabel: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface AgendaListProps {
  events: AgendaEvent[];
  formatDayHeading: (isoDate: string) => string;
  emptyLabel: string;
  onEventClick?: (eventId: string) => void;
}

/**
 * Presentational mobile/narrow-viewport agenda — groups `events` by every
 * day they cover (same `eventCoversDay` rule `MonthGrid` uses), so a
 * multi-day event like a term-long holiday shows up under each day within
 * its range, not just its `startDate`. No data hooks, same reuse contract
 * as `MonthGrid` (see its docstring).
 */
export function AgendaList({
  events,
  formatDayHeading,
  emptyLabel,
  onEventClick,
}: AgendaListProps) {
  const grouped = React.useMemo(() => {
    if (events.length === 0) return [];

    const startDates = events.map((e) => e.startDate).sort();
    const endDates = events.map((e) => e.endDate).sort();
    const firstDay = startDates[0] as string;
    const lastDay = endDates[endDates.length - 1] as string;

    const byDay = new Map<string, AgendaEvent[]>();
    for (
      let d = new Date(`${firstDay}T00:00:00Z`);
      d <= new Date(`${lastDay}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const day = d.toISOString().slice(0, 10);
      const dayEvents = events
        .filter((event) => eventCoversDay(event, day))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      if (dayEvents.length > 0) byDay.set(day, dayEvents);
    }
    return Array.from(byDay.entries());
  }, [events]);

  if (grouped.length === 0) {
    return (
      <p data-testid="agenda-empty" className="text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div data-testid="agenda-list" className="flex flex-col gap-4">
      {grouped.map(([day, dayEvents]) => (
        <section key={day} aria-label={formatDayHeading(day)}>
          <h3 className="mb-1 text-sm font-semibold">{formatDayHeading(day)}</h3>
          <ul className="flex flex-col gap-1">
            {dayEvents.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => onEventClick?.(event.id)}
                  className="flex w-full items-center gap-2 rounded p-1 text-left hover:bg-muted"
                >
                  <EventTypeBadge type={event.type} label={event.typeLabel} />
                  <span className="text-sm">{event.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
