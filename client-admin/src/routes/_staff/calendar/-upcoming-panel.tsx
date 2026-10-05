/**
 * [17.4.2] / [31.4] Upcoming events: the next few published events from
 * today, from the event list the grid already fetched — no extra query.
 * Its `upcomingPanel.*` keys are shared with [17.5.4]'s dashboard widget.
 */
import { CalendarEventType } from '@biddaloy/shared';
import { Card } from '@biddaloy/ui/components';
import type { CalendarEvent } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatDateRange, formatNumber, parseServerDate } from '@biddaloy/ui/utils';

export interface UpcomingPanelProps {
  events: CalendarEvent[];
  /** Local calendar day, `YYYY-MM-DD`. */
  today: string;
  limit?: number;
  onEventClick?: (eventId: string) => void;
}

const DOT: Record<CalendarEventType, string> = {
  HOLIDAY: 'bg-status-overdue-fg',
  EXAM: 'bg-status-partial-fg',
  DEADLINE: 'bg-status-due-fg',
  EVENT: 'bg-primary',
  MEETING: 'bg-primary',
};

const MS_PER_DAY = 86_400_000;

export function UpcomingPanel({ events, today, limit = 5, onEventClick }: UpcomingPanelProps) {
  const { t } = useTranslation('calendar');
  const regionConfig = useRegionConfig();

  const published = [...events]
    .filter((event) => event.end_date >= today && event.published)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const upcoming = published.slice(0, limit);
  const nextHoliday = published.find(
    (event) => event.type === CalendarEventType.HOLIDAY && event.start_date >= today,
  );
  const daysUntil = nextHoliday
    ? Math.round(
        (parseServerDate(nextHoliday.start_date).getTime() - parseServerDate(today).getTime()) /
          MS_PER_DAY,
      )
    : 0;

  return (
    <Card className="p-4 md:p-5">
      <h2 className="text-h3">{t('upcomingPanel.title')}</h2>
      {nextHoliday && (
        <p className="mt-1 text-text-secondary">
          {t('upcomingPanel.nextHoliday', {
            name: nextHoliday.name,
            n: formatNumber(daysUntil, regionConfig),
          })}
        </p>
      )}
      {upcoming.length === 0 ? (
        <p className="mt-2 text-text-secondary">{t('upcomingPanel.empty')}</p>
      ) : (
        <ul className="mt-2">
          {upcoming.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => onEventClick?.(event.id)}
                className="flex min-h-11 w-full items-center gap-3 py-2 text-left hover:bg-muted"
              >
                <span
                  aria-hidden="true"
                  data-testid="upcoming-dot"
                  className={`size-2 shrink-0 rounded-full ${DOT[event.type]}`}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{event.name}</span>
                <span className="shrink-0 text-text-secondary">
                  {event.end_date !== event.start_date
                    ? formatDateRange(event.start_date, event.end_date, regionConfig)
                    : formatDate(event.start_date, regionConfig)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
