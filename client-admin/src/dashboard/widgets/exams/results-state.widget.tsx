/**
 * [169.5-1902] `results-state` widget (EXAM_CONTROLLER / EXECUTIVE): how many
 * results are published. full / compact / tile (D16). The `/results` link is
 * shown only with RESULT_PROCESS (EXECUTIVE holds RESULT_READ only).
 */
import { DashboardWidgetKey, Permission } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { StatTile, StatusBadge, WidgetCard } from '@biddaloy/ui/components';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.RESULTS_STATE;

export type ResultsStateDto = components['schemas']['ResultsStateDto'];

const K = widgetKey;

function useResultsState() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'results-state'],
    queryFn: async () =>
      (await apiClient.get<ResultsStateDto>('/dashboard/widgets/results-state')).data,
    ...dashboardQueryOptions,
  });
}

export interface ResultsStateViewProps {
  data?: ResultsStateDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function ResultsStateView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: ResultsStateViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const canProcess = useHasPermission(Permission.RESULT_PROCESS);
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const n = (v: number) => formatNumber(v, region);
  const title = tw('title');
  const full = variant === 'full';

  const total = data ? data.draft + data.processed + data.published : 0;
  const value = data ? tw('value', { published: n(data.published), total: n(total) }) : '';
  const summary = data
    ? data.processed > 0
      ? tw('waiting', { count: data.processed })
      : tw('allPublished')
    : '';
  const empty = !!data && data.rounds.length === 0;

  if (variant === 'tile' && data && !empty) {
    return <StatTile label={tw('tileLabel')} value={value} note={summary} />;
  }

  const rows = data?.rounds.slice(0, full ? 5 : 3) ?? [];

  return (
    <WidgetCard
      title={title}
      variant={full ? 'full' : 'compact'}
      {...(data && !empty ? { value, summary } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty ? { empty: { reason: tw('emptyReason') } } : {})}
      footer={
        data && !empty && canProcess ? (
          <Link to="/results" className="text-primary underline">
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.exam_name} className="flex flex-col gap-1">
              <span>{r.exam_name}</span>
              <span className="flex flex-wrap gap-2">
                <StatusBadge tone="neutral" label={`${tw('stateDraft')} ${n(r.draft)}`} />
                <StatusBadge tone="warning" label={`${tw('stateProcessed')} ${n(r.processed)}`} />
                <StatusBadge tone="success" label={`${tw('statePublished')} ${n(r.published)}`} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </WidgetCard>
  );
}

export default function ResultsStateWidget({ variant }: WidgetProps) {
  const q = useResultsState();
  return (
    <ResultsStateView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
