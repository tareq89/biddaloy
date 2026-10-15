/**
 * [169.4-1886] `reminders-pending` widget: full / compact / tile. One primary
 * "Send reminders"; nothing pending -> empty reason and no button.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { Button, StatTile, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.REMINDERS_PENDING;

export type RemindersPendingDto = components['schemas']['RemindersPendingWidgetDto'];

const K = widgetKey;

function useRemindersPending() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'reminders-pending'],
    queryFn: async () =>
      (await apiClient.get<RemindersPendingDto>('/dashboard/widgets/reminders-pending')).data,
    ...dashboardQueryOptions,
  });
}

export interface RemindersPendingViewProps {
  data?: RemindersPendingDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function RemindersPendingView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: RemindersPendingViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const full = variant === 'full';
  const title = tw('title');
  const empty = !!data && data.student_count === 0;

  if (variant === 'tile' && data && !empty) {
    return <StatTile label={tw('compactTitle')} value={formatNumber(data.student_count, region)} />;
  }

  return (
    <WidgetCard
      title={full ? title : tw('compactTitle')}
      variant={full ? 'full' : 'compact'}
      {...(data && !empty
        ? {
            value: formatNumber(data.student_count, region),
            unit: tw('value', { count: data.student_count }),
            summary: tw('sentence'),
          }
        : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty ? { empty: { reason: tw('emptyReason') } } : {})}
      footer={
        data && !empty ? (
          <Button asChild className="min-h-11">
            <Link to="/communications/reminders">{tw('action')}</Link>
          </Button>
        ) : undefined
      }
    >
      {data && !empty && full && data.oldest_threshold_date ? (
        <p className="text-caption text-text-secondary">
          {tw('since', { date: formatDate(data.oldest_threshold_date, region) })}
        </p>
      ) : null}
    </WidgetCard>
  );
}

export default function RemindersPendingWidget({ variant }: WidgetProps) {
  const q = useRemindersPending();
  return (
    <RemindersPendingView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
