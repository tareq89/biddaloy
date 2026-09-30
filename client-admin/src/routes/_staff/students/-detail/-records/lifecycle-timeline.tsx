/** [39.3.3] Vertical lifecycle timeline, newest first. Same list on every width. */
import { useLifecycleEvents, type StudentLifecycleEvent } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';

import { TabQueryState } from '../tab-query-state';

export function sortNewestFirst(events: StudentLifecycleEvent[]): StudentLifecycleEvent[] {
  return [...events].sort(
    (a, b) =>
      b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at),
  );
}

export function LifecycleTimeline({ studentId }: { studentId: string }) {
  const { t } = useTranslation('student-records');
  const regionConfig = useRegionConfig();
  const query = useLifecycleEvents(studentId);

  return (
    <section aria-labelledby="lifecycle-title" className="flex flex-col gap-3">
      <h3 id="lifecycle-title" className="text-base font-semibold">
        {t('timeline.title')}
      </h3>
      <TabQueryState
        query={query}
        forbiddenMessage={t('tab.forbidden')}
        errorMessage={t('tab.error')}
      >
        {(events) =>
          events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-subtle p-6 text-center text-sm text-muted-foreground">
              {t('timeline.empty')}
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {sortNewestFirst(events).map((event) => (
                <li
                  key={event.id}
                  className="flex flex-col gap-1 rounded-lg border border-border-subtle p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border bg-accent px-2 py-0.5 text-xs font-medium">
                      {t(`timeline.types.${event.event_type}`)}
                    </span>
                    <time className="text-sm text-muted-foreground" dateTime={event.occurred_on}>
                      {formatDate(parseServerDate(event.occurred_on), regionConfig)}
                    </time>
                  </div>
                  <p className="text-sm">
                    <span className="text-muted-foreground">{t('timeline.reason')}: </span>
                    {event.reason}
                  </p>
                  {event.destination && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">{t('timeline.destination')}: </span>
                      {event.destination}
                    </p>
                  )}
                  {event.remark && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">{t('timeline.remark')}: </span>
                      {event.remark}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )
        }
      </TabQueryState>
    </section>
  );
}
