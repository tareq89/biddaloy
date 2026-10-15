/**
 * [8.10.7.5.02] `committee-attendance` widget: full / compact / tile (D16).
 * Aggregates only (D23): monthly percentages, no link out. A month without a
 * register is `null`: skipped in the line, shown as "No register" in the table.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import {
  ChartTableToggle,
  LineChart,
  Sparkline,
  StatTile,
  WidgetCard,
} from '@biddaloy/ui/components';
import { type RegionConfig, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatMonth, formatMonthName, formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

import type { CommitteeTable } from './committee-enrollment.widget';

export const widgetKey = DashboardWidgetKey.COMMITTEE_ATTENDANCE;

export type CommitteeAttendanceDto = components['schemas']['CommitteeAttendanceDto'];
type T = TFunction;

const K = widgetKey;

export function useCommitteeAttendance() {
  return useQuery({
    queryKey: ['dashboard', 'widget', K],
    queryFn: async ({ signal }) =>
      (await apiClient.get<CommitteeAttendanceDto>(`/dashboard/widgets/${K}`, { signal })).data,
    ...dashboardQueryOptions,
  });
}

const pctText = (v: number, config: RegionConfig) => `${formatNumber(v, config, { decimals: 1 })}%`;

/** The rows the toggle shows; the printed report prints the same ones. */
export function committeeAttendanceTable(
  data: CommitteeAttendanceDto,
  t: T,
  config: RegionConfig,
): CommitteeTable {
  return {
    caption: t(`widgets.${K}.title`),
    columns: [t(`widgets.${K}.colMonth`), t(`widgets.${K}.colPercent`)],
    rows: data.months.map((m) => [
      formatMonth(m.month, config),
      m.percentage == null ? t(`widgets.${K}.noRegister`) : pctText(m.percentage, config),
    ]),
    numeric: [false, true],
  };
}

export interface CommitteeAttendanceViewProps {
  data?: CommitteeAttendanceDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  updatedLabel?: string;
}

export function CommitteeAttendanceView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
  updatedLabel,
}: CommitteeAttendanceViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const pct = (v: number) => pctText(v, region);

  const title = tw('title');
  // A null month has no register: it is dropped from the line, kept in the table.
  const drawn = (data?.months ?? []).flatMap((m) =>
    m.percentage == null ? [] : [{ month: m.month, y: m.percentage }],
  );
  const empty = !!data && drawn.length === 0;
  const lowest = drawn.reduce<(typeof drawn)[number] | undefined>(
    (lo, p) => (lo === undefined || p.y < lo.y ? p : lo),
    undefined,
  );
  const highest = drawn.reduce((hi, p) => Math.max(hi, p.y), 0);
  const current = data?.current_month_percentage ?? drawn[drawn.length - 1]?.y ?? null;

  const summary =
    lowest && current != null
      ? tw('summary', {
          month: formatMonthName(Number(lowest.month.slice(5, 7)), region),
          low: pct(lowest.y),
          current: pct(current),
        })
      : undefined;
  const value = data?.year_percentage != null ? pct(data.year_percentage) : undefined;

  if (variant === 'tile' && data && !empty) {
    const now = data.current_month_percentage;
    const gap = now == null ? null : data.target_percentage - now;
    const target = pct(data.target_percentage);
    return (
      <StatTile
        label={tw('tileLabel')}
        value={now == null ? '—' : pct(now)}
        {...(gap == null
          ? {}
          : {
              trend:
                gap <= 0
                  ? { direction: 'up', text: tw('targetMet', { target }), tone: 'good' }
                  : {
                      direction: 'down',
                      text: tw('targetGap', {
                        target,
                        gap: pct(Math.round(gap * 10) / 10),
                      }),
                      tone: 'bad',
                    },
            })}
      >
        <Sparkline
          values={drawn.map((p) => p.y)}
          label={tw('sparkLabel', { low: pct(lowest?.y ?? 0), high: pct(highest) })}
          showLastDot
        />
      </StatTile>
    );
  }

  const lowestIndex = lowest ? drawn.indexOf(lowest) : -1;
  const lastIndex = drawn.length - 1;
  const body = data ? (
    <ChartTableToggle
      summary={summary ?? title}
      table={committeeAttendanceTable(data, t, region)}
      showTableLabel={t('widgets.common.showTable')}
      showChartLabel={t('widgets.common.showChart')}
    >
      <LineChart
        label={summary ?? title}
        points={drawn.map((p) => ({
          x: formatMonthName(Number(p.month.slice(5, 7)), region),
          y: p.y,
          valueLabel: pct(p.y),
        }))}
        formatTick={(n) => `${formatNumber(n, region)}%`}
        yDomain={[0, 100]}
        target={{
          value: data.target_percentage,
          label: tw('targetLine', { target: pct(data.target_percentage) }),
        }}
        labelled={[...new Set([lowestIndex, lastIndex].filter((i) => i >= 0))]}
        currentIndex={lastIndex}
      />
    </ChartTableToggle>
  ) : null;

  return (
    <WidgetCard
      title={title}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(value && !empty ? { value } : {})}
      {...(value && !empty && variant === 'full' ? { unit: tw('valueUnit') } : {})}
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

export default function CommitteeAttendanceWidget({ variant }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const q = useCommitteeAttendance();
  const minutes = q.dataUpdatedAt ? Math.floor((Date.now() - q.dataUpdatedAt) / 60_000) : null;
  const updatedLabel =
    minutes == null
      ? undefined
      : minutes < 1
        ? t('widgets.common.updatedJustNow')
        : t('widgets.common.updatedMinutes', { count: minutes });
  return (
    <CommitteeAttendanceView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
      {...(updatedLabel ? { updatedLabel } : {})}
    />
  );
}
