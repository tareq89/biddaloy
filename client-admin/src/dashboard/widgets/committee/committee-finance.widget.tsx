/**
 * [8.10.7.5.02] `committee-finance` widget: full / compact / tile (D16).
 * Aggregates only (D23): money totals per month, no link out. "Collected" is
 * the amount applied to bills, not physical cash. Future months are absent
 * from the series (not null). The only client arithmetic is the
 * Σpaid ÷ Σbilled percentage and the percentage-point difference (D25).
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import {
  ChartTableToggle,
  ColumnChart,
  Meter,
  StackedBar,
  StatTile,
  WidgetCard,
} from '@biddaloy/ui/components';
import { type RegionConfig, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatMonth, formatMonthName, formatNumber, formatServerAmount } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

import type { CommitteeTable } from './committee-enrollment.widget';

export const widgetKey = DashboardWidgetKey.COMMITTEE_FINANCE;

export type CommitteeFinanceDto = components['schemas']['CommitteeFinanceDto'];
type T = TFunction;

const K = widgetKey;

export function useCommitteeFinance() {
  return useQuery({
    queryKey: ['dashboard', 'widget', K],
    queryFn: async ({ signal }) =>
      (await apiClient.get<CommitteeFinanceDto>(`/dashboard/widgets/${K}`, { signal })).data,
    ...dashboardQueryOptions,
  });
}

/** The rows the toggle shows; the printed report prints the same ones. */
export function committeeFinanceTable(
  data: CommitteeFinanceDto,
  t: T,
  config: RegionConfig,
): CommitteeTable {
  return {
    caption: t(`widgets.${K}.title`),
    columns: [
      t(`widgets.${K}.colMonth`),
      t(`widgets.${K}.colBilled`),
      t(`widgets.${K}.colCollected`),
      t(`widgets.${K}.colOutstanding`),
    ],
    rows: data.months.map((m) => [
      formatMonth(m.month, config),
      formatServerAmount(m.billed, config),
      formatServerAmount(m.paid, config),
      formatServerAmount(m.outstanding, config),
    ]),
    numeric: [false, true, true, true],
  };
}

/** Σpaid ÷ Σbilled as a whole percent; null when nothing was billed. */
export function committeeCollectedPercent(data: CommitteeFinanceDto): number | null {
  const billed = data.months.reduce((s, m) => s + m.billed, 0);
  const paid = data.months.reduce((s, m) => s + m.paid, 0);
  return billed > 0 ? Math.round((paid / billed) * 100) : null;
}

export interface CommitteeFinanceViewProps {
  data?: CommitteeFinanceDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  updatedLabel?: string;
}

export function CommitteeFinanceView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
  updatedLabel,
}: CommitteeFinanceViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const pct = (v: number) => `${formatNumber(v, region)}%`;
  const amount = (v: number) => formatServerAmount(v, region);

  const title = tw('title');
  const months = data?.months ?? [];
  const empty = !!data && months.length === 0;

  if (variant === 'tile' && data && !empty) {
    const cur = data.current_month;
    const ly = cur.last_year_same_point?.received_pct ?? null;
    const diff = cur.received_pct != null && ly != null ? cur.received_pct - ly : null;
    const trend =
      diff == null
        ? { direction: 'flat' as const, text: tw('lastYearNone'), tone: 'neutral' as const }
        : {
            direction: diff > 0 ? ('up' as const) : diff < 0 ? ('down' as const) : ('flat' as const),
            text: tw(diff < 0 ? 'vsLastYearDown' : 'vsLastYearUp', { diff: pct(Math.abs(diff)) }),
            tone: diff > 0 ? ('good' as const) : diff < 0 ? ('bad' as const) : ('neutral' as const),
          };
    return (
      <StatTile
        label={tw('tileLabel')}
        value={cur.received_pct == null ? '—' : pct(cur.received_pct)}
        trend={trend}
        note={tw('tileNote', {
          received: amount(cur.received),
          billed: amount(cur.billed_for_month),
        })}
      >
        <Meter
          label={tw('tileLabel')}
          value={cur.received_pct ?? 0}
          max={100}
          valueText={pct(cur.received_pct ?? 0)}
          showText={false}
        />
      </StatTile>
    );
  }

  const collected = data ? committeeCollectedPercent(data) : null;
  const summary = collected == null ? undefined : tw('summary', { percent: pct(collected) });
  const lastThree = months.slice(-3);
  const lastIndex = months.length - 1;
  const body = data ? (
    <ChartTableToggle
      summary={summary ?? title}
      table={committeeFinanceTable(data, t, region)}
      showTableLabel={t('widgets.common.showTable')}
      showChartLabel={t('widgets.common.showChart')}
    >
      <div className="hidden md:block">
        <ColumnChart
          label={summary ?? title}
          series={[
            { id: 'collected', label: tw('seriesCollected'), color: 'primary' },
            { id: 'outstanding', label: tw('seriesOutstanding'), color: 'cat-2' },
          ]}
          data={months.map((m) => ({
            x: formatMonthName(Number(m.month.slice(5, 7)), region),
            values: { collected: m.paid, outstanding: m.outstanding },
            valueLabels: { collected: amount(m.paid), outstanding: amount(m.outstanding) },
          }))}
          formatTick={amount}
          labelled={[lastIndex]}
          currentIndex={lastIndex}
          legend
        />
      </div>
      <div className="flex flex-col gap-3 md:hidden">
        {lastThree.map((m) => (
          <StackedBar
            key={m.month}
            label={formatMonth(m.month, region)}
            size="md"
            legend={false}
            segments={[
              {
                id: 'collected',
                label: tw('seriesCollected'),
                value: m.paid,
                valueLabel: amount(m.paid),
                color: 'primary',
              },
              {
                id: 'outstanding',
                label: tw('seriesOutstanding'),
                value: m.outstanding,
                valueLabel: amount(m.outstanding),
                color: 'cat-2',
              },
            ]}
          />
        ))}
        <p className="text-caption text-text-secondary">
          {tw('lastThreeMonths')} · {tw('seriesCollected')} · {tw('seriesOutstanding')}
        </p>
      </div>
    </ChartTableToggle>
  ) : null;

  return (
    <WidgetCard
      title={title}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(data && !empty ? { value: amount(data.year_outstanding) } : {})}
      {...(data && !empty && variant === 'full' ? { unit: tw('valueUnit') } : {})}
      {...(summary && !empty ? { summary } : {})}
      {...(updatedLabel && variant === 'full' ? { updatedLabel } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty ? { empty: { reason: tw('emptyReason') } } : {})}
    >
      {body}
    </WidgetCard>
  );
}

export default function CommitteeFinanceWidget({ variant }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const q = useCommitteeFinance();
  const minutes = q.dataUpdatedAt ? Math.floor((Date.now() - q.dataUpdatedAt) / 60_000) : null;
  const updatedLabel =
    minutes == null
      ? undefined
      : minutes < 1
        ? t('widgets.common.updatedJustNow')
        : t('widgets.common.updatedMinutes', { count: minutes });
  return (
    <CommitteeFinanceView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
      {...(updatedLabel ? { updatedLabel } : {})}
    />
  );
}
