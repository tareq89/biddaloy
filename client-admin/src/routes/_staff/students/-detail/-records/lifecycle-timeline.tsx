/** [39.3.3] Vertical lifecycle timeline, newest first. Same list on every width. */
import { Card, StatusBadge, type StatusTone } from '@biddaloy/ui/components';
import { useLifecycleEvents, type StudentLifecycleEvent } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';

import { TabQueryState } from '../tab-query-state';

const EVENT_TONE: Record<string, StatusTone> = {
  WITHDRAWN: 'neutral',
  TRANSFERRED_OUT: 'info',
  GRADUATED: 'success',
  READMITTED: 'success',
};

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
    <Card padded asChild>
      <section aria-labelledby="lifecycle-title">
        <h2 id="lifecycle-title" className="text-h2">
          {t('timeline.title')}
        </h2>
        <TabQueryState
          query={query}
          forbiddenMessage={t('tab.forbidden')}
          errorMessage={t('tab.error')}
        >
          {(events) =>
            events.length === 0 ? (
              <p className="mt-2 text-text-secondary">{t('timeline.empty')}</p>
            ) : (
              <ol className="mt-2 divide-y divide-border-subtle">
                {sortNewestFirst(events).map((event) => (
                  <li key={event.id} className="flex flex-col gap-1 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        tone={EVENT_TONE[event.event_type] ?? 'neutral'}
                        label={t(`timeline.types.${event.event_type}`)}
                      />
                      <time className="text-text-secondary" dateTime={event.occurred_on}>
                        {formatDate(parseServerDate(event.occurred_on), regionConfig)}
                      </time>
                    </div>
                    <p>
                      <span className="text-text-secondary">{t('timeline.reason')}: </span>
                      {event.reason}
                    </p>
                    {event.destination && (
                      <p>
                        <span className="text-text-secondary">{t('timeline.destination')}: </span>
                        {event.destination}
                      </p>
                    )}
                    {event.remark && (
                      <p>
                        <span className="text-text-secondary">{t('timeline.remark')}: </span>
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
    </Card>
  );
}
