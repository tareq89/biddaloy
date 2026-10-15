/**
 * [169.4-1883] `my-pending-sections` widget: full / compact / tile (D16).
 * One primary action per card (P5): take attendance for the first pending section.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { Button, StatTile, StatusBadge, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.MY_PENDING_SECTIONS;

export type MyPendingSectionsDto = components['schemas']['MyPendingSectionsDto'];

const K = widgetKey;

function useMyPendingSections() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'my-pending-sections'],
    queryFn: async () =>
      (await apiClient.get<MyPendingSectionsDto>('/dashboard/widgets/my-pending-sections')).data,
    ...dashboardQueryOptions,
  });
}

export interface MyPendingSectionsViewProps {
  data?: MyPendingSectionsDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function MyPendingSectionsView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: MyPendingSectionsViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const label = (s: { class_name: string; section_name: string }) =>
    `${s.class_name} ${s.section_name}`;

  const title = tw('title');
  const closed = data?.is_working_day === false;
  const first = data?.sections.find((s) => !s.taken);
  const count = data?.pending_count ?? 0;
  const full = variant === 'full';

  if (variant === 'tile' && data && !closed) {
    return (
      <StatTile
        label={tw('compactTitle')}
        value={formatNumber(count, region)}
        {...(first ? { note: tw('compactHint', { section: label(first) }) } : {})}
      />
    );
  }

  const summary = closed
    ? tw('closedToday')
    : first
      ? tw('sentence', { section: label(first) })
      : tw('allTaken');

  const body =
    data && full && !closed ? (
      <ul className="flex flex-col gap-2">
        {data.sections.map((s) => (
          <li key={s.section_id} className="flex items-center justify-between gap-2">
            <span>{label(s)}</span>
            <StatusBadge
              tone={s.taken ? 'success' : 'warning'}
              label={s.taken ? tw('taken') : tw('pending')}
            />
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <WidgetCard
      title={full ? title : tw('compactTitle')}
      variant={full ? 'full' : 'compact'}
      {...(data && !closed
        ? { value: formatNumber(count, region), unit: tw('value', { count }) }
        : {})}
      {...(data ? { summary } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      footer={
        first && !closed ? (
          <Button asChild className="min-h-11">
            <Link
              to="/attendance/$sectionId"
              params={{ sectionId: first.section_id }}
              search={{ date: data!.date }}
            >
              {tw('action', { section: label(first) })}
            </Link>
          </Button>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function MyPendingSectionsWidget({ variant }: WidgetProps) {
  const q = useMyPendingSections();
  return (
    <MyPendingSectionsView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
