/**
 * [17.4.2] Desktop sidebar: the next few events after today, from the
 * same event list the grid/agenda already fetched — no extra query.
 * Also reused (via `calendar.json`'s shared `upcomingPanel.*` keys) by
 * [17.5.4]'s dashboard widget.
 */
import { Card, EventTypeBadge } from '@biddaloy/ui/components';
import type { CalendarEvent } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';

export interface UpcomingPanelProps {
  events: CalendarEvent[];
  today: string;
  limit?: number;
  onEventClick?: (eventId: string) => void;
}

export function UpcomingPanel({ events, today, limit = 5, onEventClick }: UpcomingPanelProps) {
  const { t } = useTranslation('calendar');
  const regionConfig = useRegionConfig();

  const upcoming = [...events]
    .filter((event) => event.end_date >= today && event.published)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, limit);

  return (
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-semibold">{t('upcomingPanel.title')}</h2>
      <ul className="flex flex-col gap-2">
        {upcoming.map((event) => (
          <li key={event.id}>
            <button
              type="button"
              onClick={() => onEventClick?.(event.id)}
              className="flex w-full items-center gap-2 rounded p-1 text-left hover:bg-muted"
            >
              <EventTypeBadge type={event.type} label={t(`types.${event.type}`)} />
              <span className="text-sm">{event.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {formatDate(parseServerDate(event.start_date), regionConfig)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
