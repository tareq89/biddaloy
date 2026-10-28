/**
 * [169.4-1885] `collection-by-month` widget: full / compact. Figures are
 * "amount applied to bills (net of reversals), not physical cash". The DTO
 * carries no date, so "the first N days" uses the tenant's own today.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { ChartTableToggle, LineChart, Sparkline, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  formatMonth,
  formatMonthName,
  formatNumber,
  formatServerAmount,
  tenantTodayIso,
} from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.COLLECTION_BY_MONTH;

export type CollectionByMonthDto = components['schemas']['CollectionByMonthWidgetDto'];

const K = widgetKey;

function useCollectionByMonth() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'collection-by-month'],
    queryFn: async () =>
      (await apiClient.get<CollectionByMonthDto>('/dashboard/widgets/collection-by-month')).data,
    ...dashboardQueryOptions,
  });
}

export interface CollectionByMonthViewProps {
  data?: CollectionByMonthDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function CollectionByMonthView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: CollectionByMonthViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const amount = (v: number) => formatServerAmount(v, region);
  const linkClass = 'text-primary underline';

  const title = tw('title');
  const months = data?.months ?? [];
  const empty = !!data && months.every((m) => !m.net);
  const currentIdx = months.findIndex((m) => m.is_current);
  const firstFuture = months.findIndex((m) => m.net === null);
  // Months drawn so far: up to and including the current one.
  const soFar = months.filter((m) => m.net !== null).map((m) => m.net as number);

  // Peak = the highest finished month.
  let peakIdx = -1;
  months.forEach((m, i) => {
    if (m.net !== null && !m.is_current && (peakIdx < 0 || m.net > (months[peakIdx]!.net ?? 0)))
      peakIdx = i;
  });
  const peakText =
    data && peakIdx >= 0
      ? tw('peak', {
          amount: amount(months[peakIdx]!.net as number),
          month: formatMonth(
            `${months[peakIdx]!.year}-${String(months[peakIdx]!.month).padStart(2, '0')}`,
            region,
          ),
        })
      : undefined;

  let sentence: string | undefined;
  if (data && currentIdx >= 0) {
    const cur = months[currentIdx]!.month;
    const diff = data.month_to_date_net - data.previous_month_same_days_net;
    sentence = tw(diff < 0 ? 'vsLastMonthLess' : 'vsLastMonthMore', {
      amount: amount(data.month_to_date_net),
      days: Number(tenantTodayIso(region).slice(8, 10)),
      month: formatMonthName(cur, region),
      prevMonth: formatMonthName(cur === 1 ? 12 : cur - 1, region),
      diff: amount(Math.abs(diff)),
    });
  }

  const body =
    data && variant === 'full' ? (
      <ChartTableToggle
        summary={sentence ?? ''}
        table={{
          caption: title,
          columns: [tw('colMonth'), tw('colAmount')],
          rows: months.map((m) => [
            formatMonth(`${m.year}-${String(m.month).padStart(2, '0')}`, region),
            m.net === null ? '—' : amount(m.net),
          ]),
          numeric: [false, true],
        }}
        showTableLabel={t('widgets.common.showTable')}
        showChartLabel={t('widgets.common.showChart')}
      >
        <div className="flex flex-col gap-2">
          <LineChart
            label={sentence ?? title}
            points={months.map((m) => ({
              x: formatMonthName(m.month, region),
              y: m.net ?? 0,
              valueLabel: m.net === null ? '—' : amount(m.net),
            }))}
            formatTick={(n) => formatNumber(n, region)}
            {...(firstFuture >= 0 ? { futureFrom: firstFuture } : {})}
            {...(currentIdx >= 0 ? { inProgressFrom: currentIdx, currentIndex: currentIdx } : {})}
            labelled={peakIdx >= 0 ? [peakIdx] : []}
          />
          {peakText ? <p className="text-caption text-text-secondary">{peakText}</p> : null}
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-text-secondary">
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="w-4 border-t-2 border-primary" />
              {tw('legendDone')}
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="w-4 border-t-2 border-dotted border-primary" />
              {tw('legendRunning')}
            </li>
          </ul>
        </div>
      </ChartTableToggle>
    ) : data && !empty ? (
      <Sparkline values={soFar} label={title} showLastDot />
    ) : null;

  return (
    <WidgetCard
      title={title}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(data && !empty ? { value: amount(data.year_to_date_net), summary: tw('value') } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty ? { empty: { reason: tw('emptyReason') } } : {})}
      footer={
        data ? (
          <Link to="/reports/collections" className={linkClass}>
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {empty ? null : body}
    </WidgetCard>
  );
}

export default function CollectionByMonthWidget({ variant }: WidgetProps) {
  const q = useCollectionByMonth();
  return (
    <CollectionByMonthView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
