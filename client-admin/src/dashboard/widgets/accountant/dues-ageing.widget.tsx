/**
 * [169.4-1887] `dues-ageing` widget: full / compact / tile. Buckets are shown
 * as the server returns them (three, in order); colours run light -> dark as
 * dues get older (sequential ramp, D23).
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import {
  ChartTableToggle,
  StackedBar,
  StatTile,
  WidgetCard,
  type StackedBarColor,
} from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, formatServerAmount } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.DUES_AGEING;

export type DuesAgeingDto = components['schemas']['DuesAgeingWidgetDto'];

const K = widgetKey;

const BUCKET_COLOR: Record<string, StackedBarColor> = {
  '0_30': 'seq-1',
  '31_60': 'seq-2',
  '60_PLUS': 'seq-3',
};

function useDuesAgeing() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'dues-ageing'],
    queryFn: async () =>
      (await apiClient.get<DuesAgeingDto>('/dashboard/widgets/dues-ageing')).data,
    ...dashboardQueryOptions,
  });
}

export interface DuesAgeingViewProps {
  data?: DuesAgeingDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function DuesAgeingView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: DuesAgeingViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const amount = (v: number) => formatServerAmount(v, region);
  const pct = (v: number) => `${formatNumber(v, region)}%`;
  const full = variant === 'full';

  const title = tw('title');
  const empty = !!data && data.total_due === 0;
  const buckets = data?.buckets ?? [];
  const oldest = buckets.find((b) => b.bucket === '60_PLUS');
  const sentence = oldest ? tw('sentence', { amount: amount(oldest.amount) }) : undefined;

  const segments = buckets.map((b) => ({
    id: b.bucket,
    label: tw(`bucket.${b.bucket}`),
    value: b.amount,
    valueLabel: amount(b.amount),
    detail: pct(b.share_pct),
    color: BUCKET_COLOR[b.bucket] ?? 'muted',
  }));

  if (variant === 'tile' && data && !empty) {
    return (
      <StatTile label={tw('compactTitle')} value={amount(data.total_due)}>
        <StackedBar label={title} segments={segments} legend={false} size="sm" />
      </StatTile>
    );
  }

  const body =
    data && full && !empty ? (
      <ChartTableToggle
        summary={sentence ?? ''}
        table={{
          caption: title,
          columns: [tw('colAge'), tw('colAmount'), tw('colShare')],
          rows: buckets.map((b) => [tw(`bucket.${b.bucket}`), amount(b.amount), pct(b.share_pct)]),
          numeric: [false, true, true],
        }}
        showTableLabel={t('widgets.common.showTable')}
        showChartLabel={t('widgets.common.showChart')}
      >
        <StackedBar label={title} segments={segments} />
      </ChartTableToggle>
    ) : null;

  return (
    <WidgetCard
      title={full ? title : tw('compactTitle')}
      variant={full ? 'full' : 'compact'}
      {...(data && !empty
        ? { value: amount(data.total_due), ...(sentence && !full ? { summary: sentence } : {}) }
        : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty ? { empty: { reason: tw('emptyReason') } } : {})}
      footer={
        data && !empty ? (
          <Link to="/fees/dues" className="text-primary underline">
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function DuesAgeingWidget({ variant }: WidgetProps) {
  const q = useDuesAgeing();
  return (
    <DuesAgeingView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
