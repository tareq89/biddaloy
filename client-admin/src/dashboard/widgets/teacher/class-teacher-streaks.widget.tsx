/**
 * [169.4-1884] `class-teacher-streaks` widget: full / compact (not a phone tile).
 * Student names show here, which is why the server 403s COMMITTEE.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { StatusBadge, WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.CLASS_TEACHER_STREAKS;

export type ClassTeacherStreaksDto = components['schemas']['ClassTeacherStreaksDto'];

const K = widgetKey;

function useClassTeacherStreaks() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'class-teacher-streaks'],
    queryFn: async () =>
      (await apiClient.get<ClassTeacherStreaksDto>('/dashboard/widgets/class-teacher-streaks'))
        .data,
    ...dashboardQueryOptions,
  });
}

export interface ClassTeacherStreaksViewProps {
  data?: ClassTeacherStreaksDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function ClassTeacherStreaksView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: ClassTeacherStreaksViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const n = (v: number) => formatNumber(v, region);

  const title = tw('title');
  const full = variant === 'full';
  const section = data?.section;
  const sectionName = section ? `${section.class_name} ${section.section_name}` : '';
  const items = data?.items ?? [];
  const longest = items[0]; // server: longest first
  const shortest = items[items.length - 1];
  const emptyReason = !data
    ? undefined
    : !section
      ? tw('notClassTeacher')
      : items.length === 0
        ? tw('emptyReason')
        : undefined;

  const link = (text: string) =>
    section ? (
      <Link
        to="/my-class/$sectionId"
        params={{ sectionId: section.section_id }}
        className="text-primary underline"
      >
        {text}
      </Link>
    ) : null;

  const body =
    data && full && !emptyReason ? (
      <ul className="flex flex-col gap-2">
        {items.slice(0, 3).map((i) => (
          <li key={i.student_id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{i.student_name}</span>
              <span className="text-caption text-text-secondary">
                {tw('roll', { roll: n(i.roll_number) })}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge
                tone={i.length >= 5 ? 'danger' : 'warning'}
                label={tw('daysBadge', { days: n(i.length) })}
              />
              {link(tw('notify'))}
            </span>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <WidgetCard
      title={full ? title : tw('compactTitle', { section: sectionName })}
      variant={full ? 'full' : 'compact'}
      {...(data && !emptyReason && longest && shortest
        ? {
            value: n(data.total),
            unit: tw('value', { days: n(shortest.length) }),
            summary: tw('sentence', { name: longest.student_name, days: n(longest.length) }),
          }
        : {})}
      {...(full && data?.as_of_date && !emptyReason
        ? { updatedLabel: tw('subtitle', { date: formatDate(data.as_of_date, region) }) }
        : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(emptyReason ? { empty: { reason: emptyReason } } : {})}
      footer={!emptyReason && data ? link(tw('link', { section: sectionName })) : undefined}
    >
      {body}
    </WidgetCard>
  );
}

export default function ClassTeacherStreaksWidget({ variant }: WidgetProps) {
  const q = useClassTeacherStreaks();
  return (
    <ClassTeacherStreaksView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
