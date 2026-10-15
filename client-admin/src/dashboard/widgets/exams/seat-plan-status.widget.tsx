/**
 * [169.5-1902] `seat-plan-status` widget (EXAM_CONTROLLER): exams still to
 * seat-plan. full / compact only (not a phone tile, D16). Rows never show the
 * exam id (P4).
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { Button, StatusBadge, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.SEAT_PLAN_STATUS;

export type SeatPlanStatusDto = components['schemas']['SeatPlanStatusDto'];
type Exam = SeatPlanStatusDto['exams'][number];

const K = widgetKey;

function useSeatPlanStatus() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'seat-plan-status'],
    queryFn: async () =>
      (await apiClient.get<SeatPlanStatusDto>('/dashboard/widgets/seat-plan-status')).data,
    ...dashboardQueryOptions,
  });
}

export interface SeatPlanStatusViewProps {
  data?: SeatPlanStatusDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function SeatPlanStatusView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: SeatPlanStatusViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const title = tw('title');
  const full = variant === 'full';

  const rowText = (e: Exam) => tw('row', { exam: e.exam_name, class: e.class_name });
  const badge = (e: Exam) =>
    e.published_count === e.schedule_count ? (
      <StatusBadge tone="success" label={tw('statusPublished')} />
    ) : e.planned_count > 0 ? (
      <StatusBadge tone="warning" label={tw('statusDraft')} />
    ) : (
      <StatusBadge tone="neutral" label={tw('statusNotStarted')} />
    );

  const needing = data?.exams_needing_plan ?? 0;
  const first = data?.exams[0];
  const summary = needing === 0 ? tw('allPlanned') : !full && first ? rowText(first) : undefined;
  // 5 rows on desktop, 3 on the phone (compact expanded, D16).
  const rows = data?.exams.slice(0, full ? 5 : 3) ?? [];
  const empty = !!data && data.exams.length === 0;

  return (
    <WidgetCard
      title={title}
      variant={full ? 'full' : 'compact'}
      {...(data && !empty ? { value: tw('value', { count: needing }) } : {})}
      {...(data && summary ? { summary } : {})}
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
                <Button asChild variant="outline" className="min-h-11">
                  <Link to="/exams">{tw('emptyAction')}</Link>
                </Button>
              ),
            },
          }
        : {})}
      footer={
        data && !empty ? (
          <Link to="/exams/seat-plans" className="text-primary underline">
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {rows.map((e) => (
            <li key={e.exam_id} className="flex items-start justify-between gap-2">
              <div className="flex flex-col">
                <span>{rowText(e)}</span>
                <span className="text-sm text-muted-foreground">
                  {tw('startsOn', { date: formatDate(e.first_date, region) })}
                  {' · '}
                  {tw('rowProgress', {
                    planned: formatNumber(e.planned_count, region),
                    total: formatNumber(e.schedule_count, region),
                  })}
                </span>
              </div>
              {badge(e)}
            </li>
          ))}
        </ul>
      ) : null}
    </WidgetCard>
  );
}

export default function SeatPlanStatusWidget({ variant }: WidgetProps) {
  const q = useSeatPlanStatus();
  return (
    <SeatPlanStatusView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
