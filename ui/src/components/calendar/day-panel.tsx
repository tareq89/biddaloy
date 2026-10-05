/** D26: the selected day's events beside/under the month grid. */
import * as React from 'react';

import { useRegionConfig, useTranslation } from '../../i18n';
import { cn } from '../../primitives/lib/utils';
import { formatDate, formatDateRange, formatWeekday } from '../../utils/date';

import { EVENT_DOT_CLASSES } from './event-type-badge';
import type { MonthGridEvent } from './month-grid';

export interface DayPanelProps {
  date: string;
  events: MonthGridEvent[];
  onEventClick?: (id: string) => void;
}

export function DayPanel({ date, events, onEventClick }: DayPanelProps) {
  const { t } = useTranslation('common');
  const regionConfig = useRegionConfig();
  const id = React.useId();
  return (
    <aside
      aria-labelledby={id}
      className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:w-80 md:shrink-0 md:p-5"
    >
      <h3 id={id} className="text-h3">
        {formatDate(date, regionConfig)}
      </h3>
      <p className="text-text-secondary">
        {formatWeekday(date, regionConfig)} · {t('dayPanel.eventCount', { count: events.length })}
      </p>
      {events.length === 0 ? (
        <p className="mt-3 text-text-secondary">{t('dayPanel.empty')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border-subtle">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-3 py-3">
              <span
                aria-hidden="true"
                className={cn('mt-2 size-2 shrink-0 rounded-full', EVENT_DOT_CLASSES[event.type])}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {onEventClick ? (
                    <button
                      type="button"
                      className="text-start font-medium hover:underline"
                      onClick={() => onEventClick(event.id)}
                    >
                      {event.name}
                    </button>
                  ) : (
                    <span className="font-medium">{event.name}</span>
                  )}
                  {event.badge}
                </div>
                <p className="text-text-secondary">
                  {event.startDate === event.endDate
                    ? event.typeLabel
                    : `${formatDateRange(event.startDate, event.endDate, regionConfig)} · ${event.typeLabel}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
