/**
 * [8.10.7.5.02] `committee-pass-rate` widget: full / compact / tile (D16).
 * Aggregates only (D23): one pass percentage per class, no link out.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import {
  BarWidget,
  ChartTableToggle,
  Sparkline,
  StatTile,
  WidgetCard,
} from '@biddaloy/ui/components';
import { type RegionConfig, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

import type { CommitteeTable } from './committee-enrollment.widget';

export const widgetKey = DashboardWidgetKey.COMMITTEE_PASS_RATE;

export type CommitteePassRateDto = components['schemas']['CommitteePassRateDto'];
type T = TFunction;

const K = widgetKey;

export function useCommitteePassRate() {
  return useQuery({
    queryKey: ['dashboard', 'widget', K],
    queryFn: async ({ signal }) =>
      (await apiClient.get<CommitteePassRateDto>(`/dashboard/widgets/${K}`, { signal })).data,
    ...dashboardQueryOptions,
  });
}

const pctText = (v: number, config: RegionConfig) => `${formatNumber(v, config, { decimals: 1 })}%`;

/** The rows the toggle shows; the printed report prints the same ones. */
export function committeePassRateTable(
  data: CommitteePassRateDto,
  t: T,
  config: RegionConfig,
): CommitteeTable {
  return {
    caption: t(`widgets.${K}.title`),
    columns: [t('widgets.common.colClass'), t(`widgets.${K}.colPass`)],
    rows: data.classes.map((c) => [c.class_name, pctText(c.pass_percentage, config)]),
    numeric: [false, true],
  };
}

export interface CommitteePassRateViewProps {
  data?: CommitteePassRateDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  updatedLabel?: string;
}

export function CommitteePassRateView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
  updatedLabel,
}: CommitteePassRateViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const pct = (v: number) => pctText(v, region);

  const title = tw('title');
  const empty = !!data && (data.exam_name === null || data.classes.length === 0);
  const overall = data?.overall_pass_percentage ?? null;
  const lowest = (data?.classes ?? []).reduce<CommitteePassRateDto['classes'][number] | undefined>(
    (lo, c) => (lo === undefined || c.pass_percentage < lo.pass_percentage ? c : lo),
    undefined,
  );

  if (variant === 'tile' && data && !empty) {
    const prev = data.previous_pass_percentage;
    const diff = overall != null && prev != null ? Math.round((overall - prev) * 10) / 10 : null;
    const trend =
      diff == null
        ? { direction: 'flat' as const, text: tw('noPrevious'), tone: 'neutral' as const }
        : {
            direction: diff > 0 ? ('up' as const) : diff < 0 ? ('down' as const) : ('flat' as const),
            text: tw(diff < 0 ? 'vsPreviousDown' : 'vsPreviousUp', { diff: pct(Math.abs(diff)) }),
            tone: diff > 0 ? ('good' as const) : diff < 0 ? ('bad' as const) : ('neutral' as const),
          };
    return (
      <StatTile
        label={tw('tileLabel')}
        value={overall == null ? '—' : pct(overall)}
        trend={trend}
      >
        <Sparkline
          values={data.recent_rounds.map((r) => r.pass_percentage)}
          label={tw('sparkLabel', { count: data.recent_rounds.length })}
          showLastDot
        />
      </StatTile>
    );
  }

  const gap =
    overall != null && lowest ? Math.round((overall - lowest.pass_percentage) * 10) / 10 : null;
  const summary =
    data && lowest && gap != null
      ? tw('summary', { exam: data.exam_name, class: lowest.class_name, gap: pct(gap) })
      : undefined;
  const average = overall == null ? undefined : tw('average', { percent: pct(overall) });
  const body =
    data && !empty ? (
      <ChartTableToggle
        summary={summary ?? title}
        table={committeePassRateTable(data, t, region)}
        showTableLabel={t('widgets.common.showTable')}
        showChartLabel={t('widgets.common.showChart')}
      >
        <BarWidget
          bare
          emphasis="highlighted"
          emptyLabel={tw('emptyReason')}
          bars={data.classes.map((c) => ({
            label: c.class_name,
            value: c.pass_percentage,
            valueLabel: pct(c.pass_percentage),
            ...(c === lowest ? { highlight: true } : {}),
          }))}
          {...(overall != null && average ? { target: { value: overall, label: average } } : {})}
        />
      </ChartTableToggle>
    ) : null;

  return (
    <WidgetCard
      title={title}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(lowest && !empty ? { value: pct(lowest.pass_percentage) } : {})}
      {...(lowest && !empty && variant === 'full'
        ? { unit: tw('lowestUnit', { class: lowest.class_name }) }
        : {})}
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

export default function CommitteePassRateWidget({ variant }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const q = useCommitteePassRate();
  const minutes = q.dataUpdatedAt ? Math.floor((Date.now() - q.dataUpdatedAt) / 60_000) : null;
  const updatedLabel =
    minutes == null
      ? undefined
      : minutes < 1
        ? t('widgets.common.updatedJustNow')
        : t('widgets.common.updatedMinutes', { count: minutes });
  return (
    <CommitteePassRateView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
      {...(updatedLabel ? { updatedLabel } : {})}
    />
  );
}
