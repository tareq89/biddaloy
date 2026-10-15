/**
 * [169.4-1884] `my-leave-balance` widget: full / compact / tile (D16).
 * Role-neutral: also on the ACCOUNTANT, OFFICE_STAFF and EXAM_CONTROLLER dashboards.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { Button, Meter, StatTile, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.MY_LEAVE_BALANCE;

export type MyLeaveBalanceDto = components['schemas']['MyLeaveBalanceDto'];

const K = widgetKey;

function useMyLeaveBalance() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'my-leave-balance'],
    queryFn: async () =>
      (await apiClient.get<MyLeaveBalanceDto>('/dashboard/widgets/my-leave-balance')).data,
    ...dashboardQueryOptions,
  });
}

export interface MyLeaveBalanceViewProps {
  data?: MyLeaveBalanceDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function MyLeaveBalanceView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: MyLeaveBalanceViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const n = (v: number) => formatNumber(v, region);

  const title = tw('title');
  const full = variant === 'full';
  const noProfile = !!data && !data.has_profile;
  // quota 0: Meter's own pct() is 0, never a division by zero.
  const meter = (showText: boolean) =>
    data ? (
      <Meter
        label={title}
        value={data.total_used_days}
        max={data.total_quota_days}
        valueText={tw('used', { count: n(data.total_used_days) })}
        endText={tw('quota', { count: n(data.total_quota_days) })}
        showText={showText}
        {...(showText ? {} : { size: 'sm' as const })}
      />
    ) : null;

  if (variant === 'tile' && data && !noProfile) {
    return (
      <StatTile label={title} value={n(data.total_balance_days)} note={tw('value')}>
        {meter(false)}
      </StatTile>
    );
  }

  return (
    <WidgetCard
      title={title}
      variant={full ? 'full' : 'compact'}
      {...(data && !noProfile
        ? {
            value: n(data.total_balance_days),
            unit: tw('value'),
            summary: tw('sentence', {
              used: n(data.total_used_days),
              quota: n(data.total_quota_days),
            }),
          }
        : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(noProfile ? { empty: { reason: tw('noProfile') } } : {})}
      footer={
        data && !noProfile ? (
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/attendance/staff/leave">{tw('action')}</Link>
          </Button>
        ) : undefined
      }
    >
      {data && full && !noProfile ? meter(true) : null}
    </WidgetCard>
  );
}

export default function MyLeaveBalanceWidget({ variant }: WidgetProps) {
  const q = useMyLeaveBalance();
  return (
    <MyLeaveBalanceView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
