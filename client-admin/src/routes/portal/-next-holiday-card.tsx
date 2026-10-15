/**
 * [8.10.7.5.08] Portal overview card: the next holiday in the coming 60 days
 * (the same `GET /calendar/events` call `upcoming-calendar-card.tsx` makes).
 * "Today" is the school's date, not the browser's. `NextHolidayCardView` is
 * presentational (stories render it); `NextHolidayCard` owns the query.
 */
import { CalendarEventType } from '@biddaloy/shared';
import { WidgetCard } from '@biddaloy/ui/components';
import { calendarEventsQueryOptions } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  formatDate,
  formatWeekday,
  parseDate,
  tenantTodayIso,
  toIsoDate,
} from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CalendarHeartIcon } from 'lucide-react';

const WINDOW_DAYS = 60;
const FETCH_LIMIT = 6;
const MS_PER_DAY = 86_400_000;

export interface NextHoliday {
  name: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Whole days from the school's today; 0 = today. */
  inDays: number;
}

export interface NextHolidayCardViewProps {
  variant: 'full' | 'compact';
  holiday: NextHoliday | null;
  /** The school's current month, `YYYY-MM`, for the calendar link. */
  month: string;
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function NextHolidayCardView({
  variant,
  holiday,
  month,
  loading = false,
  failed = false,
  onRetry,
}: NextHolidayCardViewProps) {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();

  const inDays = holiday
    ? holiday.inDays <= 0
      ? t('nextHoliday.today')
      : t('nextHoliday.inDays', { count: holiday.inDays })
    : '';
  const date = holiday
    ? `${formatWeekday(holiday.date, config)}, ${formatDate(holiday.date, config)}`
    : '';
  const link = (
    <Link to="/portal/calendar" search={{ month }} className="text-primary underline">
      {t('nextHoliday.link')}
    </Link>
  );

  return (
    <WidgetCard
      title={t('nextHoliday.title')}
      variant={variant}
      loading={loading}
      loadingLabel={t('nextHoliday.title')}
      {...(failed && onRetry
        ? { error: { message: t('error.message'), retryLabel: t('error.retry'), onRetry } }
        : {})}
      {...(!holiday ? { empty: { reason: t('nextHoliday.emptyReason'), action: link } } : {})}
      {...(holiday
        ? {
            value: holiday.name,
            summary: variant === 'compact' ? `${date} · ${inDays}` : date,
            footer: link,
          }
        : {})}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
          <CalendarHeartIcon className="size-5" aria-hidden="true" />
        </span>
        <span className="rounded-full bg-secondary px-3 py-1 text-label text-secondary-foreground">
          {inDays}
        </span>
      </div>
    </WidgetCard>
  );
}

export function NextHolidayCard() {
  const config = useRegionConfig();
  const today = tenantTodayIso(config);
  const end = parseDate(today);
  end.setDate(end.getDate() + WINDOW_DAYS);
  const to = toIsoDate(end);
  const query = useQuery(calendarEventsQueryOptions({ from: today, to, limit: FETCH_LIMIT }));

  // The portal's family DTO has no `published` field: `!== false` still passes it.
  const first = query.data?.data
    .filter((event) => event.published !== false && event.type === CalendarEventType.HOLIDAY)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const date = first?.start_date.slice(0, 10);
  const props = {
    month: today.slice(0, 7),
    holiday:
      first && date
        ? {
            name: first.name,
            date,
            // Rounded: a DST change inside the window makes a day 23 or 25 hours.
            inDays: Math.round(
              (parseDate(date).getTime() - parseDate(today).getTime()) / MS_PER_DAY,
            ),
          }
        : null,
    loading: query.isPending,
    failed: query.isError,
    onRetry: () => void query.refetch(),
  };
  return (
    <>
      <div className="hidden h-full md:block">
        <NextHolidayCardView variant="full" {...props} />
      </div>
      <div className="md:hidden">
        <NextHolidayCardView variant="compact" {...props} />
      </div>
    </>
  );
}
