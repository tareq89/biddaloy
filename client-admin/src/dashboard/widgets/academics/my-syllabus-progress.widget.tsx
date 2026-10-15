/**
 * [169.4-1896] `my-syllabus-progress` widget: full + compact, no phone tile.
 * [8.10.7.7.05] Once a subject has a study plan the bar gets a marker at the
 * expected % and a "N% behind" note; without one only the `noPace` line shows.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { BarWidget, ChartTableToggle, WidgetCard } from '@biddaloy/ui/components';
import { useLocale, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.MY_SYLLABUS_PROGRESS;

export type MySyllabusProgressDto = components['schemas']['MySyllabusProgressDto'];

const K = widgetKey;

function useMySyllabusProgress() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'my-syllabus-progress'],
    queryFn: async () =>
      (await apiClient.get<MySyllabusProgressDto>('/dashboard/widgets/my-syllabus-progress')).data,
    ...dashboardQueryOptions,
  });
}

export interface MySyllabusProgressViewProps {
  data?: MySyllabusProgressDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function MySyllabusProgressView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: MySyllabusProgressViewProps) {
  const { t } = useTranslation('dashboard');
  const { locale } = useLocale();
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const pct = (v: number) => `${formatNumber(v, region)}%`;
  const linkClass = 'text-primary underline';
  const full = variant === 'full';

  const title = tw('title');
  const items = data?.items ?? [];
  const empty = !!data && items.length === 0;
  const rows = [...items]
    .sort((a, b) => a.percentage - b.percentage)
    .map((i) => ({
      label: `${i.class_name} ${i.sections.map((s) => s.section_name).join(', ')} ${
        (locale === 'bn' && i.subject_name_bn) || i.subject_name_en
      }`,
      percentage: i.percentage,
      expected: i.expected_percentage ?? null,
    }));
  // BarWidget draws one marker for every bar, so it shows the mean expected % of planned subjects.
  const planned = rows.filter((r) => r.expected !== null);
  const expectedMean = planned.length
    ? Math.round(planned.reduce((n, r) => n + (r.expected ?? 0), 0) / planned.length)
    : undefined;
  const behindBy = (r: (typeof rows)[number]) =>
    r.expected !== null && r.expected > r.percentage ? r.expected - r.percentage : 0;
  const behindCount = data?.behind_count ?? 0;
  const totalTopics = items.reduce((sum, i) => sum + i.total, 0);
  const average =
    totalTopics === 0
      ? 0
      : Math.round((items.reduce((sum, i) => sum + i.done, 0) / totalTopics) * 100);
  const lowest = rows[0];
  const leastText = lowest
    ? tw('leastCovered', { label: lowest.label, percent: pct(lowest.percentage) })
    : undefined;

  const body =
    data && full && !empty ? (
      <div className="flex flex-col gap-2">
        <ChartTableToggle
          summary={leastText ?? title}
          table={{
            caption: title,
            columns: [tw('colSubject'), tw('colCovered'), tw('colExpected'), tw('colGap')],
            rows: rows.map((r) => [
              r.label,
              pct(r.percentage),
              r.expected === null ? '–' : pct(r.expected),
              behindBy(r) > 0 ? pct(behindBy(r)) : '–',
            ]),
            numeric: [false, true, true, true],
          }}
          showTableLabel={t('widgets.common.showTable')}
          showChartLabel={t('widgets.common.showChart')}
        >
          <BarWidget
            bare
            emphasis="highlighted"
            emptyLabel={tw('emptyReason')}
            {...(expectedMean !== undefined
              ? {
                  target: {
                    value: expectedMean,
                    label: tw('expectedMarker', { percent: pct(expectedMean) }),
                  },
                }
              : {})}
            bars={rows.map((r, idx) => ({
              label: r.label,
              value: r.percentage,
              valueLabel: pct(r.percentage),
              highlight: idx === 0 || behindBy(r) > 0,
              ...(behindBy(r) > 0 ? { note: tw('gap', { percent: pct(behindBy(r)) }) } : {}),
            }))}
          />
        </ChartTableToggle>
        <p className="text-caption text-text-secondary">
          {expectedMean === undefined
            ? tw('noPace')
            : behindCount > 0
              ? tw('behindSubjects', { count: behindCount })
              : tw('onPace')}
        </p>
      </div>
    ) : null;

  return (
    <WidgetCard
      title={full ? title : tw('compactTitle')}
      variant={full ? 'full' : 'compact'}
      {...(data && !empty ? { value: pct(average), unit: tw('value') } : {})}
      {...(leastText && !empty && !full ? { summary: leastText } : {})}
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
                  {tw('link')}
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

export default function MySyllabusProgressWidget({ variant }: WidgetProps) {
  const q = useMySyllabusProgress();
  return (
    <MySyllabusProgressView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
