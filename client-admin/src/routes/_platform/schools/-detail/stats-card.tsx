/**
 * #535's five-number stats card — `GET /schools/:id/stats` (#532),
 * presentational only (`SchoolDetailPage` wires the live query) so it can
 * be storied on its own, same split every other `-detail/*` component in
 * this codebase follows (`-schools-list-view.tsx`, `-create-school-wizard.tsx`).
 */
import { Card, ErrorState, Skeleton } from '@biddaloy/ui/components';
import type { SchoolStats } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface StatsCardProps {
  stats?: SchoolStats;
  loading: boolean;
  error?: string;
  onRetry?: () => void;
}

export function StatsCard({ stats, loading, error, onRetry }: StatsCardProps) {
  const { t } = useTranslation('platform');

  if (loading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  if (error || !stats) {
    return (
      <Card className="p-4">
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
      value: String(stats.active_users),
    },
    { id: 'students', label: t('schoolDetail.stats.students'), value: String(stats.students) },
    {
      id: 'communications_queued',
      label: t('schoolDetail.stats.communicationsQueued'),
      value: String(stats.communications_queued),
    },
    {
      id: 'communications_failed_7d',
      label: t('schoolDetail.stats.communicationsFailed7d'),
      value: String(stats.communications_failed_7d),
    },
    {
      id: 'last_activity_at',
      label: t('schoolDetail.stats.lastActivity'),
      value: stats.last_activity_at
        ? new Date(stats.last_activity_at).toLocaleString()
        : t('schoolDetail.stats.never'),
    },
  ];

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold">{t('schoolDetail.stats.title')}</h2>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => (
          <div key={item.id} className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="text-lg font-semibold">{item.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
