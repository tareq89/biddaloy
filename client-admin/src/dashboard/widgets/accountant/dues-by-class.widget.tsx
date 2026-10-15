/**
 * [169.4-1887] `dues-by-class` widget: full / compact. The server sorts the
 * classes, largest first; the bar shows the top five, the table all of them.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { BarWidget, ChartTableToggle, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, formatServerAmount } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.DUES_BY_CLASS;

export type DuesByClassDto = components['schemas']['DuesByClassWidgetDto'];

const K = widgetKey;
const TOP = 5;

function useDuesByClass() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'dues-by-class'],
    queryFn: async () =>
      (await apiClient.get<DuesByClassDto>('/dashboard/widgets/dues-by-class')).data,
    ...dashboardQueryOptions,
  });
}

export interface DuesByClassViewProps {
  data?: DuesByClassDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function DuesByClassView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: DuesByClassViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const amount = (v: number) => formatServerAmount(v, region);
  const full = variant === 'full';

  const title = tw('title');
  const classes = data?.classes ?? [];
  const top = classes[0];
  const empty = !!data && (!top || data.total_due <= 0);
  const sentence =
    data && top && !empty
      ? tw('sentence', {
          percent: `${formatNumber(Math.round((top.amount / data.total_due) * 100), region)}%`,
          class: top.class_name,
        })
      : undefined;

  const body =
    data && full && top && !empty ? (
      <ChartTableToggle
        summary={sentence ?? ''}
        table={{
          caption: title,
          columns: [tw('colClass'), tw('colAmount'), tw('colStudents')],
          rows: classes.map((c) => [
            c.class_name,
            amount(c.amount),
            formatNumber(c.student_count, region),
          ]),
          numeric: [false, true, true],
        }}
        showTableLabel={t('widgets.common.showTable')}
        showChartLabel={t('widgets.common.showChart')}
      >
        <BarWidget
          bare
          emphasis="highlighted"
          max={top.amount}
          emptyLabel={tw('emptyReason')}
          bars={classes.slice(0, TOP).map((c, i) => ({
            label: c.class_name,
            value: c.amount,
            valueLabel: amount(c.amount),
            highlight: i === 0,
          }))}
        />
      </ChartTableToggle>
    ) : null;

  return (
    <WidgetCard
      title={title}
      variant={full ? 'full' : 'compact'}
      {...(data && top && !empty
        ? {
            value: amount(top.amount),
            unit: tw('value', { class: top.class_name }),
            ...(sentence && !full ? { summary: sentence } : {}),
          }
        : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty ? { empty: { reason: tw('emptyReason') } } : {})}
      footer={
        top && !empty ? (
          <Link
            to="/fees/dues"
            search={{ class_id: top.class_id }}
            className="text-primary underline"
          >
            {tw('link', { class: top.class_name })}
          </Link>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function DuesByClassWidget({ variant }: WidgetProps) {
  const q = useDuesByClass();
  return (
    <DuesByClassView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
