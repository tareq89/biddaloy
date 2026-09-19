/**
 * [17.5.4] "Upcoming" calendar widget — staff dashboard and portal
 * home. Fetches the next 60 days of published events (`GET
 * /calendar/events?from=today&to=today+60d&limit=6`), shows the next
 * `HOLIDAY` as a headline ("Next holiday: Victory Day · in 12 days")
 * and up to five events (date, type icon, name) below it, each
 * linking to `calendarPath` (`/calendar` on the staff dashboard,
 * `/portal/calendar` on portal home — same component, different
 * link target per surface, per the ticket's own wording).
 *
 * Staff-side gating lives here (`CALENDAR_READ`, same rule
 * `CalendarFeedCard` uses); the portal variant takes no permission
 * prop at all and is mounted unconditionally — the portal route is
 * already role-gated server-side, same pattern [17.5.1]/[17.5.2] use.
 */
import { CalendarEventType, Permission } from '@biddaloy/shared';
import { Card, EventTypeBadge, Skeleton } from '@biddaloy/ui/components';
import { calendarEventsQueryOptions, useHasPermission } from '@biddaloy/ui/hooks';
import type { CalendarEvent } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

const WINDOW_DAYS = 60;
const FETCH_LIMIT = 6;
const DISPLAY_LIMIT = 5;
const MS_PER_DAY = 86_400_000;

export interface UpcomingCalendarCardProps {
  /** `/calendar` on the staff dashboard, `/portal/calendar` on portal home. */
  calendarPath: '/calendar' | '/portal/calendar';
  /** Staff surface only — omitted entirely on the portal variant, which
   * is already role-gated server-side. */
  requirePermission?: boolean;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function UpcomingCalendarCard({
  calendarPath,
  requirePermission = false,
}: UpcomingCalendarCardProps) {
  const { t } = useTranslation('calendar');
  const regionConfig = useRegionConfig();
  // Always called (rules-of-hooks) even on the portal variant, where the
  // result is simply ignored — the portal route is already role-gated
  // server-side and takes no permission prop at all.
  const hasCalendarRead = useHasPermission(Permission.CALENDAR_READ);
  const canRead = requirePermission ? hasCalendarRead : true;

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const from = toIsoDate(today);
  const to = toIsoDate(addDays(today, WINDOW_DAYS));

  const eventsQuery = useQuery({
    ...calendarEventsQueryOptions({ from, to, limit: FETCH_LIMIT }),
    enabled: canRead,
  });

  if (!canRead) return null;

  if (eventsQuery.isPending) {
    return (
      <Card className="flex flex-col gap-2 p-4" aria-busy="true">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </Card>
    );
  }

  if (eventsQuery.isError) {
    return (
      <Card className="p-4">
        <h2 className="mb-1 text-sm font-semibold">{t('upcomingPanel.title')}</h2>
        <p className="text-sm text-destructive">{t('page.errorMessage')}</p>
      </Card>
    );
  }

  const published = eventsQuery.data.data
    .filter((event) => event.published)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const nextHoliday = published.find((event) => event.type === CalendarEventType.HOLIDAY);
  const events = published.slice(0, DISPLAY_LIMIT);

  const daysUntil = (event: CalendarEvent): number =>
    Math.round((parseServerDate(event.start_date).getTime() - startOfToday.getTime()) / MS_PER_DAY);

  return (
    <Card className="flex flex-col gap-2 p-4">
      <h2 className="text-sm font-semibold">{t('upcomingPanel.title')}</h2>

      {nextHoliday && (
        <p className="text-sm text-muted-foreground">
          {t('upcomingPanel.nextHoliday', {
            name: nextHoliday.name,
            count: daysUntil(nextHoliday),
          })}
        </p>
      )}

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('upcomingPanel.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                to={calendarPath}
                className="flex w-full items-center gap-2 rounded p-1 text-left no-underline hover:bg-muted"
              >
                <EventTypeBadge type={event.type} label={t(`types.${event.type}`)} />
                <span className="text-sm">{event.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatDate(parseServerDate(event.start_date), regionConfig)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
