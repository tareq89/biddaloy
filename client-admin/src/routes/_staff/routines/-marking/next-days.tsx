/** [66.3.01] Peek at the next days' lessons, read-only. A day loads only when opened. */
import { ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useMyLessonDeliveries } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatWeekday } from '@biddaloy/ui/utils';
import { ChevronDownIcon } from 'lucide-react';
import * as React from 'react';

export interface NextDay {
  date: string;
  periodCount: number;
  firstSection: string;
}

export function NextDays({
  days,
  subjectLabel,
}: {
  days: NextDay[];
  subjectLabel: (p: { name_en: string | null; name_bn: string | null }) => string;
}) {
  const { t } = useTranslation('routines');
  const config = useRegionConfig();
  const [openDate, setOpenDate] = React.useState<string | null>(null);
  if (days.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
      <h2 className="text-h3 font-semibold">{t('marking.nextDays')}</h2>
      <ul className="flex flex-col">
        {days.map((day) => {
          const open = openDate === day.date;
          const panelId = `next-day-${day.date}`;
          return (
            <li key={day.date} className="border-t border-border-subtle first:border-t-0">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenDate(open ? null : day.date)}
                className="flex min-h-14 w-full items-center justify-between gap-2 text-start md:min-h-11"
              >
                <span className="flex flex-col">
                  <span className="font-semibold">
                    {t('marking.dayTitle', {
                      weekday: formatWeekday(day.date, config),
                      date: formatDate(day.date, config),
                    })}
                  </span>
                  <span className="text-caption text-text-secondary">
                    {t('marking.nextDayMeta', {
                      count: day.periodCount,
                      section: day.firstSection,
                    })}
                  </span>
                </span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className={`size-4 shrink-0 ${open ? 'rotate-180' : ''}`}
                />
              </button>
              <div id={panelId} hidden={!open}>
                {open && <NextDayLessons date={day.date} subjectLabel={subjectLabel} />}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NextDayLessons({
  date,
  subjectLabel,
}: {
  date: string;
  subjectLabel: (p: { name_en: string | null; name_bn: string | null }) => string;
}) {
  const { t } = useTranslation('routines');
  const query = useMyLessonDeliveries(date);
  if (query.isPending) return <Skeleton className="mb-3 h-10 w-full" />;
  if (query.isError) {
    return (
      <ErrorState
        message={t('myRoutine.error.message')}
        retryLabel={t('myRoutine.error.retry')}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return (
    <ul className="mb-3 flex flex-col gap-2">
      {query.data.periods.map((p) => (
        <li key={p.routine_slot_id} className="flex flex-col text-body">
          <span>
            {t('agenda.periodLabel', { sequence: p.sequence })} · {p.section.name} ·{' '}
            {subjectLabel(p.subject)}
          </span>
          {p.plan_id && (
            <span className="text-caption text-text-secondary">
              {t('marking.lessonLine', { no: p.lesson.number, title: p.lesson.title })}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
