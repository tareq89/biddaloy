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
import { Button, Card, Skeleton } from '@biddaloy/ui/components';
import { calendarEventsQueryOptions, useHasPermission } from '@biddaloy/ui/hooks';
import type { CalendarEvent } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  formatDate,
  formatDateRange,
  formatNumber,
  parseServerDate,
  toIsoDate,
} from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RotateCcwIcon } from 'lucide-react';

const WINDOW_DAYS = 60;
const FETCH_LIMIT = 6;
const DISPLAY_LIMIT = 5;
const MS_PER_DAY = 86_400_000;

const DOT: Record<CalendarEventType, string> = {
  HOLIDAY: 'bg-status-overdue-fg',
  EXAM: 'bg-status-partial-fg',
  DEADLINE: 'bg-status-due-fg',
  EVENT: 'bg-primary',
  MEETING: 'bg-primary',
};

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

export function UpcomingCalendarCard({
  calendarPath,
  requirePermission = false,
}: UpcomingCalendarCardProps) {
  const { t } = useTranslation('calendar');
  const { t: tCommon } = useTranslation('common');
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
      <Card className="flex flex-col gap-2 p-4 md:p-5" aria-busy="true">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </Card>
    );
  }

  if (eventsQuery.isError) {
    return (
      <Card className="p-4 md:p-5">
        <h2 className="text-h2">{t('upcomingPanel.title')}</h2>
        <p className="mt-1 text-text-secondary">{t('page.errorMessage')}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => void eventsQuery.refetch()}
        >
          <RotateCcwIcon aria-hidden="true" />
          {tCommon('actions.retry')}
        </Button>
      </Card>
    );
  }

  const published = eventsQuery.data.data
    // The portal's FamilyCalendarEventDto has no `published` field at all
    // (allow-listed shape) — `event.published` is `undefined` there, which
    // `!== false` correctly still passes. The API already excludes drafts
    // for every caller (no `includeDrafts` passed above), so this is a
    // defensive filter, not the source of truth.
    .filter((event) => event.published !== false)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const nextHoliday = published.find((event) => event.type === CalendarEventType.HOLIDAY);
  const events = published.slice(0, DISPLAY_LIMIT);

  const daysUntil = (event: CalendarEvent): number =>
    Math.round((parseServerDate(event.start_date).getTime() - startOfToday.getTime()) / MS_PER_DAY);

  return (
    <Card className="p-4 md:p-5">
      <h2 className="text-h2">{t('upcomingPanel.title')}</h2>

      {nextHoliday && (
        <p className="mt-1 text-text-secondary">
          {t('upcomingPanel.nextHoliday', {
            name: nextHoliday.name,
            n: formatNumber(daysUntil(nextHoliday), regionConfig),
          })}
        </p>
      )}

      {events.length === 0 ? (
        <p className="mt-2 text-text-secondary">{t('upcomingPanel.empty')}</p>
      ) : (
        <ul className="mt-2">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                to={calendarPath}
                className="flex min-h-11 w-full items-center gap-3 py-2 no-underline hover:bg-muted"
              >
                <span
                  aria-hidden="true"
                  className={`size-2 shrink-0 rounded-full ${DOT[event.type]}`}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{event.name}</span>
                <span className="shrink-0 text-text-secondary">
                  {event.end_date !== event.start_date
                    ? formatDateRange(event.start_date, event.end_date, regionConfig)
                    : formatDate(event.start_date, regionConfig)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
