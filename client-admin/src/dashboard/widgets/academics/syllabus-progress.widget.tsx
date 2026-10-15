/**
 * [169.3-1875] `syllabus-progress` widget: full + compact, no phone tile.
 * No expected-pace marker until study plans ship (#1828): only the `noPace` line.
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

export const widgetKey = DashboardWidgetKey.SYLLABUS_PROGRESS;

export type SyllabusProgressDto = components['schemas']['SyllabusProgressWidgetDto'];

const K = widgetKey;

function useSyllabusProgress() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'syllabus-progress'],
    queryFn: async () =>
      (await apiClient.get<SyllabusProgressDto>('/dashboard/widgets/syllabus-progress')).data,
    ...dashboardQueryOptions,
  });
}

export interface SyllabusViewProps {
  data?: SyllabusProgressDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function SyllabusView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: SyllabusViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const pct = (v: number) => `${formatNumber(v, region)}%`;
  const linkClass = 'text-primary underline';
  const full = variant === 'full';

  const title = tw('title');
  const empty = !!data && (data.classes.length === 0 || data.overall.total === 0);
  const least = data?.classes.reduce<(typeof data.classes)[number] | undefined>(
    (low, c) => (!low || c.percentage < low.percentage ? c : low),
    undefined,
  );
  const average = data ? tw('average', { percent: pct(data.overall.percentage) }) : undefined;
  const leastText = least
    ? tw('leastCovered', { class: least.class_name, percent: pct(least.percentage) })
    : undefined;
  const summary = full ? leastText : [average, leastText].filter(Boolean).join(' ');

  const body =
    data && full && !empty ? (
      <div className="flex flex-col gap-2">
        <ChartTableToggle
          summary={average ?? title}
          table={{
            caption: title,
            columns: [t('widgets.common.colClass'), tw('colCovered')],
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
        <p className="text-caption text-text-secondary">{tw('noPace')}</p>
      </div>
    ) : null;

  return (
    <WidgetCard
      title={title}
      variant={full ? 'full' : 'compact'}
      {...(data && !empty ? { value: pct(data.overall.percentage) } : {})}
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
                <Link to="/academics/syllabus" className={linkClass}>
                  {tw('emptyAction')}
                </Link>
              ),
            },
          }
        : {})}
      footer={
        data && !empty ? (
          <Link to="/academics/syllabus" className={linkClass}>
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function SyllabusProgressWidget({ variant }: WidgetProps) {
  const q = useSyllabusProgress();
  return (
    <SyllabusView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
