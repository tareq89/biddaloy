/**
 * [8.10.7.5.08] Portal overview card: the next homework due across the
 * family's children. `HomeworkCardView` is presentational (stories render it);
 * `HomeworkCard` owns the queries, one `GET /students/:id/homework` per child,
 * and mounts both phone and desktop renderings. "Today" and "tomorrow" come
 * from the response's `today`, never the browser clock.
 */
import { WidgetCard } from '@biddaloy/ui/components';
import { useLocale, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseDate, toIsoDate } from '@biddaloy/ui/utils';
import { useQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BookOpenIcon } from 'lucide-react';

import { familyHomeworkQueryOptions } from './-use-family-homework';

const ROWS = 3;

export interface HomeworkCardItem {
  key: string;
  childName: string;
  subject: string;
  title: string;
  /** `YYYY-MM-DD`. */
  dueDate: string;
}

export interface HomeworkCardViewProps {
  variant: 'full' | 'compact';
  /** Every child's items, already sorted by due date. */
  items: HomeworkCardItem[];
  /** The school's today, `YYYY-MM-DD`. */
  today: string;
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

/** The next day of an ISO date, as an ISO date. */
function nextDay(iso: string): string {
  if (!iso) return '';
  const next = parseDate(iso);
  next.setDate(next.getDate() + 1);
  return toIsoDate(next);
}

export function HomeworkCardView({
  variant,
  items,
  today,
  loading = false,
  failed = false,
  onRetry,
}: HomeworkCardViewProps) {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const tomorrow = nextDay(today);

  const dueLabel = (due: string) =>
    due === today
      ? t('homeworkCard.dueToday')
      : due === tomorrow
        ? t('homeworkCard.dueTomorrow')
        : t('homeworkCard.dueOn', { date: formatDate(due, config) });
  const when = (due: string) =>
    due === today
      ? t('homeworkCard.whenToday')
      : due === tomorrow
        ? t('homeworkCard.whenTomorrow')
        : formatDate(due, config);

  const link = (
    <Link to="/portal/homework" className="text-primary underline">
      {t('homeworkCard.link')}
    </Link>
  );
  const soonest = items[0];
  const dueSoon = items.filter((i) => i.dueDate === today || i.dueDate === tomorrow).length;

  return (
    <WidgetCard
      title={t('homeworkCard.title')}
      variant={variant}
      loading={loading}
      loadingLabel={t('homeworkCard.title')}
      {...(failed && onRetry
        ? { error: { message: t('error.message'), retryLabel: t('error.retry'), onRetry } }
        : {})}
      {...(items.length === 0
        ? { empty: { reason: t('homeworkCard.emptyReason'), action: link } }
        : {})}
      {...(soonest && variant === 'compact'
        ? {
            value: `${t('homeworkCard.value', { count: dueSoon })} ${t('homeworkCard.valueUnit')}`,
            summary: t('homeworkCard.compactSentence', {
              child: soonest.childName,
              subject: soonest.subject,
              when: when(soonest.dueDate),
            }),
          }
        : {})}
      {...(items.length > 0 ? { footer: link } : {})}
    >
      <ul className="divide-y divide-border-subtle">
        {items.slice(0, ROWS).map((item) => (
          <li key={item.key} className="flex min-h-11 items-start gap-3 py-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
              <BookOpenIcon className="size-5" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-caption text-text-secondary">
                {item.subject} · {item.childName}
              </span>
              <span className="font-medium">{item.title}</span>
              <span className="text-caption text-text-secondary">{dueLabel(item.dueDate)}</span>
            </span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

export function HomeworkCard({ students }: { students: { id: string; fullName: string }[] }) {
  const { locale } = useLocale();
  const { t } = useTranslation('portal');
  const queries = useQueries({ queries: students.map((c) => familyHomeworkQueryOptions(c.id)) });

  const items = queries
    .flatMap((q, i) =>
      (q.data?.items ?? []).map((item) => ({
        key: `${students[i]?.id}:${item.assignment_id}`,
        childName: (students[i]?.fullName ?? '').split(' ')[0] ?? '',
        subject:
          (locale === 'bn'
            ? (item.subject_name_bn ?? item.subject_name_en)
            : item.subject_name_en) || t('syllabus.unknownSubject'),
        title: item.title,
        dueDate: item.due_date,
      })),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const props = {
    items,
    today: queries.find((q) => q.data)?.data?.today ?? '',
    loading: queries.some((q) => q.isPending),
    failed: queries.some((q) => q.isError),
    onRetry: () => queries.forEach((q) => void q.refetch()),
  };
  return (
    <>
      <div className="hidden h-full md:block">
        <HomeworkCardView variant="full" {...props} />
      </div>
      <div className="md:hidden">
        <HomeworkCardView variant="compact" {...props} />
      </div>
    </>
  );
}
