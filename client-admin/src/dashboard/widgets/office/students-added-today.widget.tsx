/**
 * [169.5-1903] `students-added-today` widget (OFFICE_STAFF): a count only.
 * Zero is a value, not an empty state.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { StatTile, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.STUDENTS_ADDED_TODAY;

export type StudentsAddedTodayDto = components['schemas']['StudentsAddedTodayDto'];

const K = widgetKey;

function useStudentsAddedToday() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'students-added-today'],
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<StudentsAddedTodayDto>('/dashboard/widgets/students-added-today', {
          signal,
        })
      ).data,
    ...dashboardQueryOptions,
  });
}

export interface StudentsAddedTodayViewProps {
  data?: StudentsAddedTodayDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function StudentsAddedTodayView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: StudentsAddedTodayViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const title = tw('title');

  if (variant === 'tile' && data) {
    return <StatTile label={tw('tileLabel')} value={formatNumber(data.added_today, region)} />;
  }

  return (
    <WidgetCard
      title={title}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(data ? { value: tw('value', { count: data.added_today }) } : {})}
      {...(data && data.added_today === 0 ? { summary: tw('none') } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      footer={
        data ? (
          <Link to="/students" className="text-primary underline">
            {tw('link')}
          </Link>
        ) : undefined
      }
    />
  );
}

export default function StudentsAddedTodayWidget({ variant }: WidgetProps) {
  const q = useStudentsAddedToday();
  return (
    <StudentsAddedTodayView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
