/**
 * [169.3-1876] `sms-balance` widget (ADMIN, D8 — visibility is the registry's
 * job). `metering: OFF` shows "not metered", never 0.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { WidgetCard } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.SMS_BALANCE;

export type SmsBalanceDto = components['schemas']['SmsBalanceWidgetDto'];

const K = widgetKey;

function useSmsBalance() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'sms-balance'],
    queryFn: async () =>
      (await apiClient.get<SmsBalanceDto>('/dashboard/widgets/sms-balance')).data,
    ...dashboardQueryOptions,
  });
}

export interface SmsBalanceViewProps {
  data?: SmsBalanceDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function SmsBalanceView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: SmsBalanceViewProps) {
  const { t } = useTranslation('dashboard');
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const title = tw('title');
  const metered = !!data && data.metering !== 'OFF';

  return (
    <WidgetCard
      title={title}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(metered ? { value: tw('value', { count: data.available }) } : {})}
      {...(data && !metered ? { summary: tw('notMetered') } : {})}
      {...(metered && data.reserved > 0
        ? { summary: tw('reserved', { count: data.reserved }) }
        : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      footer={
        data ? (
          <Link to="/communications/batches" className="text-primary underline">
            {tw('link')}
          </Link>
        ) : undefined
      }
    />
  );
}

export default function SmsBalanceWidget({ variant }: WidgetProps) {
  const q = useSmsBalance();
  return (
    <SmsBalanceView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
