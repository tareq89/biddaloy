/**
 * [169.5-1903] `admissions-today` widget (OFFICE_STAFF): new applications today.
 * Latest rows show applicant_name only (server decision), never an id. Zero is
 * a value, not an empty state.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { StatTile, StatusBadge, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, formatTime } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.ADMISSIONS_TODAY;

export type AdmissionsTodayDto = components['schemas']['AdmissionsTodayDto'];

const K = widgetKey;

function useAdmissionsToday() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'admissions-today'],
    queryFn: async ({ signal }) =>
      (await apiClient.get<AdmissionsTodayDto>('/dashboard/widgets/admissions-today', { signal }))
        .data,
    ...dashboardQueryOptions,
  });
}

export interface AdmissionsTodayViewProps {
  data?: AdmissionsTodayDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function AdmissionsTodayView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: AdmissionsTodayViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const title = tw('title');
  const full = variant === 'full';

  const pending = data ? tw('pending', { count: data.pending_total }) : '';

  if (variant === 'tile' && data) {
    return (
      <StatTile
        label={tw('tileLabel')}
        value={formatNumber(data.new_today, region)}
        note={pending}
      />
    );
  }

  const rows = data?.latest.slice(0, full ? 5 : 3) ?? [];

  return (
    <WidgetCard
      title={title}
      variant={full ? 'full' : 'compact'}
      {...(data ? { value: tw('value', { count: data.new_today }) } : {})}
      {...(data ? { summary: data.new_today === 0 ? tw('none') : pending } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      footer={
        data ? (
          <Link to="/admissions/applicants" className="text-primary underline">
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {rows.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2">
              <div className="flex flex-col">
                <span>{a.applicant_name}</span>
                {/* Reference numbers are copied, so they stay Latin (21 §7). */}
                <span className="text-sm text-muted-foreground">
                  <bdi>{a.reference_number}</bdi>
                  {' · '}
                  {formatTime(a.created_at, region)}
                </span>
              </div>
              <StatusBadge
                tone={
                  a.status === 'ADMITTED'
                    ? 'success'
                    : a.status === 'REJECTED'
                      ? 'neutral'
                      : 'warning'
                }
                label={tw(`status${a.status}`)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </WidgetCard>
  );
}

export default function AdmissionsTodayWidget({ variant }: WidgetProps) {
  const q = useAdmissionsToday();
  return (
    <AdmissionsTodayView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
