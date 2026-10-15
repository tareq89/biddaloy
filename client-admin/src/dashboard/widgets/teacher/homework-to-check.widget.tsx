/**
 * [169.4-1884] `homework-to-check` widget: full / compact / tile (D16).
 * Rows keep the server order (top by submissions waiting).
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { StatTile, WidgetCard } from '@biddaloy/ui/components';
import { useLocale, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.HOMEWORK_TO_CHECK;

export type HomeworkToCheckDto = components['schemas']['HomeworkToCheckDto'];

const K = widgetKey;

function useHomeworkToCheck() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'homework-to-check'],
    queryFn: async () =>
      (await apiClient.get<HomeworkToCheckDto>('/dashboard/widgets/homework-to-check')).data,
    ...dashboardQueryOptions,
  });
}

export interface HomeworkToCheckViewProps {
  data?: HomeworkToCheckDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function HomeworkToCheckView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: HomeworkToCheckViewProps) {
  const { t } = useTranslation('dashboard');
  const { locale } = useLocale();
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const n = (v: number) => formatNumber(v, region);

  const title = tw('title');
  const full = variant === 'full';
  const empty = !!data && data.items.length === 0;
  const first = data?.items[0];

  if (variant === 'tile' && data && !empty) {
    return (
      <StatTile
        label={tw('compactTitle')}
        value={n(data.total_submitted)}
        note={tw('compactHint', { count: data.assignment_count })}
      />
    );
  }

  const body =
    data && full && !empty ? (
      <ul className="flex flex-col gap-2">
        {data.items.slice(0, 3).map((i) => (
          <li key={i.assignment_id} className="flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{i.title}</span>
              <span className="text-caption text-text-secondary">
                {i.class_name} {i.section_name} ·{' '}
                {(locale === 'bn' && i.subject_name_bn) || i.subject_name_en}
              </span>
            </span>
            <span className="tabular-nums">{tw('rowCount', { count: n(i.submitted_count) })}</span>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <WidgetCard
      title={full ? title : tw('compactTitle')}
      variant={full ? 'full' : 'compact'}
      {...(data && !empty ? { value: n(data.total_submitted), unit: tw('value') } : {})}
      {...(data && !empty ? { summary: tw('sentence', { count: data.assignment_count }) } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty ? { empty: { reason: tw('emptyReason') } } : {})}
      footer={
        first ? (
          <Link
            to="/academics/homework/$homeworkId"
            params={{ homeworkId: first.homework_id }}
            className="text-primary underline"
          >
            {tw('action')}
          </Link>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function HomeworkToCheckWidget({ variant }: WidgetProps) {
  const q = useHomeworkToCheck();
  return (
    <HomeworkToCheckView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
