/**
 * [169.4-1883] `my-mark-deadlines` widget: full / compact / tile (D16).
 * The sentence (D40) follows the FIRST item; day counts use the tenant (Dhaka) date.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { Button, Meter, StatTile, StatusBadge, WidgetCard } from '@biddaloy/ui/components';
import { useLocale, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber, parseServerDate, tenantTodayIso } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.MY_MARK_DEADLINES;

export type MyMarkDeadlinesDto = components['schemas']['MyMarkDeadlinesDto'];

const K = widgetKey;

function useMyMarkDeadlines() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'my-mark-deadlines'],
    queryFn: async () =>
      (await apiClient.get<MyMarkDeadlinesDto>('/dashboard/widgets/my-mark-deadlines')).data,
    ...dashboardQueryOptions,
  });
}

export interface MyMarkDeadlinesViewProps {
  data?: MyMarkDeadlinesDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

const DAY = 86_400_000;

export function MyMarkDeadlinesView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: MyMarkDeadlinesViewProps) {
  const { t } = useTranslation('dashboard');
  const { locale } = useLocale();
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const n = (v: number) => formatNumber(v, region);
  const itemLabel = (i: MyMarkDeadlinesDto['items'][number]) =>
    `${i.class_name} ${i.section_name} ${(locale === 'bn' && i.subject_name_bn) || i.subject_name_en}`;
  const pct = (i: MyMarkDeadlinesDto['items'][number]) =>
    i.expected > 0 ? Math.round((i.entered / i.expected) * 100) : 0;

  const title = tw('title');
  const full = variant === 'full';
  const items = data?.items ?? [];
  const first = items[0];
  const target = items.find((i) => i.state !== 'SUBMITTED');
  const empty = !!data && items.length === 0;

  const daysFromToday = (iso: string) =>
    Math.round(
      (parseServerDate(iso).getTime() - parseServerDate(tenantTodayIso(region)).getTime()) / DAY,
    );
  let summary: string | undefined;
  if (first) {
    const section = itemLabel(first);
    if (first.mark_entry_deadline) {
      const days = daysFromToday(first.mark_entry_deadline);
      summary =
        days > 0
          ? tw('deadlineIn', {
              count: days,
              date: formatDate(first.mark_entry_deadline, region),
              section,
            })
          : days === 0
            ? tw('deadlineToday', { section })
            : tw('deadlinePassed', { count: -days, section });
    } else if (first.last_sitting_date) {
      summary = tw('endedAgo', {
        count: Math.max(0, -daysFromToday(first.last_sitting_date)),
        exam: first.exam_name,
        section,
      });
    } else summary = tw('noDate', { section });
  }

  if (variant === 'tile' && first) {
    return (
      <StatTile
        label={tw('compactTitle', { section: `${first.class_name} ${first.section_name}` })}
        value={`${n(pct(first))}%`}
      >
        <Meter
          label={itemLabel(first)}
          value={first.entered}
          max={first.expected}
          valueText={`${n(first.entered)} / ${n(first.expected)}`}
          showText={false}
          size="sm"
        />
      </StatTile>
    );
  }

  const body =
    data && full && !empty ? (
      <ul className="flex flex-col gap-3">
        {items.map((i) => (
          <li key={`${i.exam_id}-${i.section_id}-${i.subject_id}`} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span>{itemLabel(i)}</span>
              {i.state === 'SUBMITTED' ? (
                <StatusBadge tone="success" label={tw('submitted')} />
              ) : null}
            </div>
            <Meter
              label={itemLabel(i)}
              value={i.entered}
              max={i.expected}
              valueText={`${n(i.entered)} / ${n(i.expected)}`}
            />
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <WidgetCard
      title={
        full
          ? title
          : tw('compactTitle', {
              section: first ? `${first.class_name} ${first.section_name}` : '',
            })
      }
      variant={full ? 'full' : 'compact'}
      {...(data && !empty
        ? {
            value: n(data.outstanding_students),
            unit: tw('value', { count: data.outstanding_students }),
          }
        : {})}
      {...(summary ? { summary } : {})}
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
                <Link to="/marks" className="text-primary underline">
                  {title}
                </Link>
              ),
            },
          }
        : {})}
      footer={
        target ? (
          <Button asChild variant="outline" className="min-h-11">
            <Link
              to="/marks/$examId/$sectionId/$subjectId"
              params={{
                examId: target.exam_id,
                sectionId: target.section_id,
                subjectId: target.subject_id,
              }}
            >
              {tw('action', { section: itemLabel(target) })}
            </Link>
          </Button>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function MyMarkDeadlinesWidget({ variant }: WidgetProps) {
  const q = useMyMarkDeadlines();
  return (
    <MyMarkDeadlinesView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
