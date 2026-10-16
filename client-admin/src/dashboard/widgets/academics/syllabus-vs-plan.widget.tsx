/**
 * [8.10.7.7.04] `syllabus-vs-plan` widget (ADMIN): taught share per class against the share
 * the study plan expects by today, classes behind, and lessons not updated. Full + compact.
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

export const widgetKey = DashboardWidgetKey.SYLLABUS_VS_PLAN;

export type SyllabusVsPlanDto = components['schemas']['SyllabusVsPlanDto'];

const K = widgetKey;

function useSyllabusVsPlan() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'syllabus-vs-plan'],
    queryFn: async () =>
      (await apiClient.get<SyllabusVsPlanDto>('/dashboard/widgets/syllabus-vs-plan')).data,
    ...dashboardQueryOptions,
  });
}

export interface SyllabusVsPlanViewProps {
  data?: SyllabusVsPlanDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function SyllabusVsPlanView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: SyllabusVsPlanViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const n = (v: number) => formatNumber(v, region);
  const pct = (v: number) => `${n(v)}%`;
  const linkClass = 'text-primary underline';
  const full = variant === 'full';

  const title = tw('title');
  const empty = !!data && data.classes.length === 0;
  const sentence = data
    ? data.behind_count > 0
      ? tw('sentence', { count: data.behind_count })
      : tw('sentenceNone')
    : undefined;
  const notUpdated =
    data && data.not_updated_count > 0
      ? tw('notUpdated', { count: data.not_updated_count })
      : undefined;
  const summary = [sentence, notUpdated].filter(Boolean).join(' ');

  // BarWidget draws one marker for every bar: the mean expected % of the planned classes.
  const expected = data?.classes.length
    ? Math.round(
        data.classes.reduce((sum, c) => sum + c.expected_percentage, 0) / data.classes.length,
      )
    : 0;

  const body =
    data && full && !empty ? (
      <ChartTableToggle
        summary={summary || title}
        table={{
          caption: title,
          columns: [
            t('widgets.common.colClass'),
            tw('colTaught'),
            tw('colExpected'),
            tw('colGap'),
            tw('colNotUpdated'),
          ],
          rows: data.classes.map((c) => [
            c.class_name,
            pct(c.done_percentage),
            pct(c.expected_percentage),
            pct(c.behind_by),
            n(c.not_updated),
          ]),
          numeric: [false, true, true, true, true],
        }}
        showTableLabel={t('widgets.common.showTable')}
        showChartLabel={t('widgets.common.showChart')}
      >
        <BarWidget
          bare
          emphasis="highlighted"
          emptyLabel={tw('emptyReason')}
          target={{ value: expected, label: tw('expectedMarker', { percent: pct(expected) }) }}
          bars={data.classes.map((c) => ({
            label: c.class_name,
            value: c.done_percentage,
            valueLabel: pct(c.done_percentage),
            ...(c.behind_by > 0
              ? { highlight: true, note: tw('gap', { percent: pct(c.behind_by) }) }
              : {}),
          }))}
        />
      </ChartTableToggle>
    ) : null;

  return (
    <WidgetCard
      title={title}
      variant={full ? 'full' : 'compact'}
      {...(data && !empty ? { value: n(data.behind_count) } : {})}
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
                <Link to="/academics/syllabus" search={{ tab: 'plans' }} className={linkClass}>
                  {tw('emptyAction')}
                </Link>
              ),
            },
          }
        : {})}
      footer={
        data && !empty ? (
          <Link to="/academics/syllabus" search={{ tab: 'plans', behind: 1 }} className={linkClass}>
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function SyllabusVsPlanWidget({ variant }: WidgetProps) {
  const q = useSyllabusVsPlan();
  return (
    <SyllabusVsPlanView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
