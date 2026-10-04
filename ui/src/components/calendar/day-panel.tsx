/**
 * D26: the selected day's events beside/under the month grid. Stub — filled in
 * by 31.2.3a (card look, dots, detail line).
 */
import * as React from 'react';

import { useRegionConfig, useTranslation } from '../../i18n';
import { formatDate, formatWeekday, parseServerDate } from '../../utils/date';

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
    <aside aria-labelledby={id}>
      <h3 id={id} className="text-h3">
        {formatDate(parseServerDate(date), regionConfig)}
      </h3>
      <p className="text-text-secondary">
        {formatWeekday(date, regionConfig)} · {t('dayPanel.eventCount', { count: events.length })}
      </p>
      {events.length === 0 ? (
        <p>{t('dayPanel.empty')}</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {events.map((event) => (
            <li key={event.id}>
              <button type="button" onClick={() => onEventClick?.(event.id)}>
                {event.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
