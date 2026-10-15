/**
 * [8.10.7.5.02] `committee-enrollment` widget: full / compact / tile (D16).
 * Aggregates only (D23): no link out, nothing in the response is a person.
 * The hook feeds the pure `CommitteeEnrollmentView`, which the stories render;
 * `committeeEnrollmentTable` is reused by the printed report (5-07).
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import {
  ChartTableToggle,
  ColumnChart,
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

export const widgetKey = DashboardWidgetKey.COMMITTEE_ENROLLMENT;

export type CommitteeEnrollmentDto = components['schemas']['CommitteeEnrollmentDto'];
export type CommitteeTable = {
  caption: string;
  columns: string[];
  rows: string[][];
  numeric: boolean[];
};
type T = TFunction;

const K = widgetKey;

export function useCommitteeEnrollment() {
  return useQuery({
    queryKey: ['dashboard', 'widget', K],
    queryFn: async ({ signal }) =>
      (await apiClient.get<CommitteeEnrollmentDto>(`/dashboard/widgets/${K}`, { signal })).data,
    ...dashboardQueryOptions,
  });
}

/** The rows the toggle shows; the printed report prints the same ones. */
export function committeeEnrollmentTable(
  data: CommitteeEnrollmentDto,
  t: T,
  config: RegionConfig,
): CommitteeTable {
  return {
    caption: t(`widgets.${K}.title`),
    columns: [t(`widgets.${K}.colYear`), t(`widgets.${K}.colStudents`)],
    rows: data.years.map((y) => [y.year_label, formatNumber(y.student_count, config)]),
    numeric: [false, true],
  };
}

export interface CommitteeEnrollmentViewProps {
  data?: CommitteeEnrollmentDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  updatedLabel?: string;
}

export function CommitteeEnrollmentView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
  updatedLabel,
}: CommitteeEnrollmentViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const num = (v: number) => formatNumber(v, region);

  const title = tw('title');
  const years = data?.years ?? [];
  const empty = !!data && years.length === 0;
  const first = years[0];
  const last = years[years.length - 1];
  const span = years.length - 1;

  const growth =
    first && last && span > 0 && first.student_count > 0
      ? Math.round(((last.student_count - first.student_count) / first.student_count) * 100)
      : null;
  const value =
    growth == null ? undefined : `${growth < 0 ? '−' : '+'}${num(Math.abs(growth))}%`;
  const summary =
    first && last && span > 0 && last.student_count !== first.student_count
      ? tw(last.student_count > first.student_count ? 'summaryUp' : 'summaryDown', {
          from: num(first.student_count),
          to: num(last.student_count),
          years: num(span),
        })
      : undefined;

  const spark = (
    <Sparkline
      values={years.map((y) => y.student_count)}
      label={tw('sparkLabel', { from: first?.year_label, to: last?.year_label })}
      showLastDot
    />
  );

  if (variant === 'tile' && data && !empty) {
    const diff = data.previous_count == null ? null : data.current_count - data.previous_count;
    const trend =
      diff == null
        ? { direction: 'flat' as const, text: tw('noPrevious'), tone: 'neutral' as const }
        : diff === 0
          ? { direction: 'flat' as const, text: tw('trendSame'), tone: 'neutral' as const }
          : {
              direction: diff > 0 ? ('up' as const) : ('down' as const),
              text: tw(diff > 0 ? 'trendUp' : 'trendDown', { count: Math.abs(diff) }),
              tone: diff > 0 ? ('good' as const) : ('bad' as const),
            };
    return (
      <StatTile label={tw('tileLabel')} value={num(data.current_count)} trend={trend}>
        {spark}
      </StatTile>
    );
  }

  const lastIndex = years.length - 1;
  const body = data ? (
    <ChartTableToggle
      summary={summary ?? title}
      table={committeeEnrollmentTable(data, t, region)}
      showTableLabel={t('widgets.common.showTable')}
      showChartLabel={t('widgets.common.showChart')}
    >
      <ColumnChart
        label={summary ?? title}
        series={[{ id: 'students', label: tw('colStudents'), color: 'primary' }]}
        data={years.map((y) => ({
          x: y.year_label,
          values: { students: y.student_count },
          valueLabels: { students: num(y.student_count) },
        }))}
        formatTick={num}
        highlightIndex={lastIndex}
        labelled={lastIndex > 0 ? [0, lastIndex] : [0]}
        currentIndex={lastIndex}
      />
    </ChartTableToggle>
  ) : null;

  return (
    <WidgetCard
      title={title}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(value && !empty ? { value } : {})}
      {...(value && !empty && variant === 'full' ? { unit: tw('growthUnit', { years: num(span) }) } : {})}
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

export default function CommitteeEnrollmentWidget({ variant }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const q = useCommitteeEnrollment();
  const minutes = q.dataUpdatedAt ? Math.floor((Date.now() - q.dataUpdatedAt) / 60_000) : null;
  const updatedLabel =
    minutes == null
      ? undefined
      : minutes < 1
        ? t('widgets.common.updatedJustNow')
        : t('widgets.common.updatedMinutes', { count: minutes });
  return (
    <CommitteeEnrollmentView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
      {...(updatedLabel ? { updatedLabel } : {})}
    />
  );
}
