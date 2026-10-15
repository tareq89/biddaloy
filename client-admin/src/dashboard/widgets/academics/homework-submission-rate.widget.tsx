/**
 * [169.4-1896] `homework-submission-rate` widget: full + compact, no phone tile.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { BarWidget, ChartTableToggle, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.HOMEWORK_SUBMISSION_RATE;

export type HomeworkSubmissionRateDto = components['schemas']['HomeworkSubmissionRateDto'];

const K = widgetKey;

function useHomeworkSubmissionRate() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'homework-submission-rate'],
    queryFn: async () =>
      (
        await apiClient.get<HomeworkSubmissionRateDto>(
          '/dashboard/widgets/homework-submission-rate',
        )
      ).data,
    ...dashboardQueryOptions,
  });
}

export interface HomeworkSubmissionRateViewProps {
  data?: HomeworkSubmissionRateDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function HomeworkSubmissionRateView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: HomeworkSubmissionRateViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const n = (v: number) => formatNumber(v, region);
  const pct = (v: number) => `${n(v)}%`;
  const linkClass = 'text-primary underline';
  const full = variant === 'full';

  const title = tw('title');
  const empty = !!data && data.overall.assigned === 0;
  const lowest = data?.classes.reduce<(typeof data.classes)[number] | undefined>(
    (low, c) => (!low || c.percentage < low.percentage ? c : low),
    undefined,
  );
  const sentence = data
    ? tw('sentence', { submitted: n(data.overall.submitted), expected: n(data.overall.assigned) })
    : undefined;
  const lowestText = lowest
    ? tw('lowest', { class: lowest.class_name, percent: pct(lowest.percentage) })
    : undefined;
  const summary = full ? lowestText : sentence;

  const body =
    data && full && !empty ? (
      <ChartTableToggle
        summary={sentence ?? title}
        table={{
          caption: title,
          columns: [t('widgets.common.colClass'), tw('colRate')],
          rows: data.classes.map((c) => [c.class_name, pct(c.percentage)]),
          numeric: [false, true],
        }}
        showTableLabel={t('widgets.common.showTable')}
        showChartLabel={t('widgets.common.showChart')}
      >
        <BarWidget
          bare
          emptyLabel={tw('emptyReason')}
          bars={data.classes.map((c) => ({
            label: c.class_name,
            value: c.percentage,
            valueLabel: pct(c.percentage),
          }))}
        />
      </ChartTableToggle>
    ) : null;

  return (
    <WidgetCard
      title={full ? title : tw('compactTitle')}
      variant={full ? 'full' : 'compact'}
      {...(data && !empty ? { value: pct(data.overall.percentage), unit: tw('value') } : {})}
      {...(summary && !empty ? { summary } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty
        ? {
            empty: {
              reason: tw('emptyReason'),
              action: (
                <Link to="/academics/homework" className={linkClass}>
                  {tw('link')}
                </Link>
              ),
            },
          }
        : {})}
      footer={
        data && !empty ? (
          <Link to="/academics/homework" className={linkClass}>
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function HomeworkSubmissionRateWidget({ variant }: WidgetProps) {
  const q = useHomeworkSubmissionRate();
  return (
    <HomeworkSubmissionRateView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
