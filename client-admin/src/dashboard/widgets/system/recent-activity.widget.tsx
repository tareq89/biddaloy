/**
 * [169.4-1897] `recent-activity` widget: full + compact, no phone tile.
 * Sentences use the audit-log page's `auditLogs` keys.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { WidgetCard } from '@biddaloy/ui/components';
import { useLocale, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime, formatNumber, formatRelativeAge } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.RECENT_ACTIVITY;

export type RecentActivityDto = components['schemas']['RecentActivityDto'];

const K = widgetKey;
const MAX_ROWS = 8;

function useRecentActivity() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'recent-activity'],
    queryFn: async () =>
      (await apiClient.get<RecentActivityDto>('/dashboard/widgets/recent-activity')).data,
    ...dashboardQueryOptions,
  });
}

export interface RecentActivityViewProps {
  data?: RecentActivityDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function RecentActivityView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: RecentActivityViewProps) {
  const { t } = useTranslation('dashboard');
  const { t: ta } = useTranslation('auditLogs');
  const { locale } = useLocale();
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const linkClass = 'text-primary underline';
  const full = variant === 'full';

  type Item = RecentActivityDto['items'][number];
  // Same sentence rule as client-admin/src/routes/_staff/audit-logs/index.tsx
  // `summary()`; change both together.
  const sentence = (row: Item): string => {
    const entity = ta(`entityTypes.${row.entity_type}`, {
      defaultValue: ta('entityTypes.unknown'),
    }).toLocaleLowerCase();
    if (row.action === 'UPDATE') {
      const count = row.changed_field_count ?? 0;
      return ta('summaries.UPDATE', { count, n: formatNumber(count, region), entity });
    }
    return ta(`summaries.${row.action}`, {
      entity,
      defaultValue: ta(`actions.${row.action}`, { defaultValue: row.action }),
    });
  };
  const ago = (row: Item) => formatRelativeAge(Date.parse(row.created_at), locale);

  const title = tw('title');
  const items = data?.items ?? [];
  const empty = !!data && items.length === 0;
  const newest = items[0];
  const logLink = (
    <Link to="/audit-logs" className={linkClass}>
      {tw('link')}
    </Link>
  );

  const body =
    data && full && !empty ? (
      <ul className="flex flex-col gap-2">
        {items.slice(0, MAX_ROWS).map((i) => (
          <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="min-w-0">
              {tw('row', {
                actor: i.performed_by_name ?? tw('system'),
                summary: sentence(i),
              })}
            </span>
            <time
              dateTime={i.created_at}
              title={formatDateTime(new Date(i.created_at), region)}
              className="text-caption text-text-secondary"
            >
              {ago(i)}
            </time>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <WidgetCard
      title={title}
      variant={full ? 'full' : 'compact'}
      {...(!full && newest && !empty
        ? {
            summary: `${tw('row', {
              actor: newest.performed_by_name ?? tw('system'),
              summary: sentence(newest),
            })} ${ago(newest)}`,
          }
        : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty ? { empty: { reason: tw('emptyReason'), action: logLink } } : {})}
      footer={data && !empty ? logLink : undefined}
    >
      {body}
    </WidgetCard>
  );
}

export default function RecentActivityWidget({ variant }: WidgetProps) {
  const q = useRecentActivity();
  return (
    <RecentActivityView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
