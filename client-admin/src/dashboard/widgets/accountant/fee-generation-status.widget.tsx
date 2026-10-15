/**
 * [169.4-1886] `fee-generation-status` widget: full / compact. One primary per
 * card (P5): "Generate fees" only while this month's bills are not made.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { Button, StatusBadge, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.FEE_GENERATION_STATUS;

export type FeeGenerationStatusDto = components['schemas']['FeeGenerationStatusWidgetDto'];

const K = widgetKey;

function useFeeGenerationStatus() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'fee-generation-status'],
    queryFn: async () =>
      (await apiClient.get<FeeGenerationStatusDto>('/dashboard/widgets/fee-generation-status'))
        .data,
    ...dashboardQueryOptions,
  });
}

export interface FeeGenerationStatusViewProps {
  data?: FeeGenerationStatusDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function FeeGenerationStatusView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: FeeGenerationStatusViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const full = variant === 'full';
  const title = tw('title');

  const badge = data ? (
    data.generated ? (
      <StatusBadge
        tone="success"
        label={tw('generatedOn', { date: formatDate(data.first_generated_at, region) })}
      />
    ) : (
      <StatusBadge tone="warning" label={tw('notGenerated')} />
    )
  ) : null;

  const body = data ? (
    <div className="flex flex-col gap-2">
      <div>{badge}</div>
      {full ? (
        <p className="text-caption text-text-secondary">
          {data.next_scheduled_run
            ? tw('next', { date: formatDate(data.next_scheduled_run, region) })
            : tw('noSchedule')}
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <WidgetCard
      title={title}
      variant={full ? 'full' : 'compact'}
      {...(data
        ? {
            value: formatNumber(data.bill_count, region),
            unit: tw('value', { count: data.bill_count }),
          }
        : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      footer={
        data && full ? (
          data.generated ? (
            <Button asChild variant="outline" className="min-h-11">
              <Link to="/invoices">{tw('link')}</Link>
            </Button>
          ) : (
            <Button asChild className="min-h-11">
              <Link to="/fees/generate" search={{ generate: 1 }}>
                {tw('generateAction')}
              </Link>
            </Button>
          )
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function FeeGenerationStatusWidget({ variant }: WidgetProps) {
  const q = useFeeGenerationStatus();
  return (
    <FeeGenerationStatusView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
