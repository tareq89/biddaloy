/**
 * #535's five-number stats card — `GET /schools/:id/stats` (#532),
 * presentational only (`SchoolDetailPage` wires the live query) so it can
 * be storied on its own, same split every other `-detail/*` component in
 * this codebase follows (`-schools-list-view.tsx`, `-create-school-wizard.tsx`).
 */
import { Card, ErrorState, Skeleton } from '@biddaloy/ui/components';
import type { SchoolStats } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime, formatNumber } from '@biddaloy/ui/utils';

export interface StatsCardProps {
  stats?: SchoolStats;
  loading: boolean;
  error?: string;
  onRetry?: () => void;
}

export function StatsCard({ stats, loading, error, onRetry }: StatsCardProps) {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();

  if (loading) {
    return (
      <Card padded>
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  if (error || !stats) {
    return (
      <Card padded>
        <ErrorState
          message={error ?? t('schoolDetail.stats.loadError')}
          retryLabel={t('actions.retry', { ns: 'common' })}
          onRetry={onRetry ?? (() => {})}
        />
      </Card>
    );
  }

  const items: { id: string; label: string; value: string }[] = [
    {
      id: 'active_users',
      label: t('schoolDetail.stats.activeUsers'),
      value: formatNumber(stats.active_users, config),
    },
    {
      id: 'students',
      label: t('schoolDetail.stats.students'),
      value: formatNumber(stats.students, config),
    },
    {
      id: 'communications_queued',
      label: t('schoolDetail.stats.communicationsQueued'),
      value: formatNumber(stats.communications_queued, config),
    },
    {
      id: 'communications_failed_7d',
      label: t('schoolDetail.stats.communicationsFailed7d'),
      value: formatNumber(stats.communications_failed_7d, config),
    },
    {
      id: 'last_activity_at',
      label: t('schoolDetail.stats.lastActivity'),
      value: stats.last_activity_at
        ? formatDateTime(stats.last_activity_at, config)
        : t('schoolDetail.stats.never'),
    },
  ];

  return (
    <Card padded>
      <h2 className="text-h2">{t('schoolDetail.stats.title')}</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-5">
        {items.map((item) => (
          <div
            key={item.id}
            className={item.id === 'last_activity_at' ? 'col-span-2 md:col-span-1' : undefined}
          >
            <dt className="text-caption text-text-secondary">{item.label}</dt>
            <dd className={item.id === 'last_activity_at' ? 'font-medium' : 'text-h2 tabular-nums'}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
