/**
 * [169.4-1885] `collection-today` widget: full / compact / tile. Figures are
 * "amount applied to bills (net of reversals), not physical cash". Groups and
 * their method rows render in the server's order; nothing is re-grouped.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import {
  ChartTableToggle,
  StackedBar,
  StatTile,
  WidgetCard,
  type StackedBarColor,
} from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, formatServerAmount } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.COLLECTION_TODAY;

export type CollectionTodayDto = components['schemas']['CollectionTodayWidgetDto'];

const K = widgetKey;

// Categorical chart tokens (D23); the fourth group has no token, so it is muted.
const GROUP_COLOR: Record<string, StackedBarColor> = {
  CASH: 'cat-1',
  BKASH: 'cat-2',
  BANK: 'cat-3',
  OTHER_MOBILE: 'muted',
};

function useCollectionToday() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'collection-today'],
    queryFn: async () =>
      (await apiClient.get<CollectionTodayDto>('/dashboard/widgets/collection-today')).data,
    ...dashboardQueryOptions,
  });
}

export interface CollectionTodayViewProps {
  data?: CollectionTodayDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function CollectionTodayView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: CollectionTodayViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const amount = (v: number) => formatServerAmount(v, region);
  const groupName = (g: string) => tw(`group.${g}`);
  const methodName = (m: string) => t(`widgets.paymentMethod.${m}`);
  const linkClass = 'text-primary underline';

  const title = tw('title');
  const groups = data?.groups ?? [];
  // Empty means no payment at all; reversals can make the net 0 or negative, which is shown.
  const empty = !!data && data.payment_count === 0;
  const top = groups.reduce<(typeof groups)[number] | undefined>(
    (best, g) => (!best || g.net > best.net ? g : best),
    undefined,
  );
  const topSentence =
    top && top.net > 0 ? tw('topGroup', { group: groupName(top.group) }) : undefined;
  // Schema types this as a number, but a day with no yesterday data is shown as "—" (D25).
  const yesterday = data?.yesterday_same_time_net ?? null;
  const diff = data && yesterday != null ? data.net - yesterday : null;

  if (variant === 'tile' && data && !empty) {
    return (
      <StatTile
        label={tw('compactTitle')}
        value={amount(data.net)}
        {...(diff != null
          ? {
              trend: {
                direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
                text: tw('compactDelta', { amount: amount(Math.abs(diff)) }),
                tone: diff > 0 ? 'good' : diff < 0 ? 'bad' : 'neutral',
              },
            }
          : {})}
      />
    );
  }

  const body =
    data && variant === 'full' ? (
      <div className="flex flex-col gap-2">
        <p className="text-caption text-text-secondary">
          {yesterday != null
            ? tw('vsYesterday', { amount: amount(yesterday) })
            : tw('vsYesterdayNone')}
        </p>
        <ChartTableToggle
          summary={topSentence ?? ''}
          table={{
            caption: title,
            columns: [tw('colMethod'), tw('colAmount'), tw('colCount')],
            rows: groups.flatMap((g) => [
              [groupName(g.group), amount(g.net), formatNumber(g.payment_count, region)],
              ...g.methods.map((m) => [
                `· ${methodName(m.payment_method)}`,
                amount(m.net),
                formatNumber(m.payment_count, region),
              ]),
            ]),
            numeric: [false, true, true],
          }}
          showTableLabel={t('widgets.common.showTable')}
          showChartLabel={t('widgets.common.showChart')}
        >
          <div className="flex flex-col gap-3">
            <StackedBar
              label={title}
              legend={false}
              segments={groups.map((g) => ({
                id: g.group,
                label: groupName(g.group),
                value: g.net,
                valueLabel: amount(g.net),
                color: GROUP_COLOR[g.group] ?? 'muted',
              }))}
            />
            <ul className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              {groups.map((g) => (
                <li key={g.group} data-testid={`group-${g.group}`} className="flex flex-col">
                  <span data-testid="group-label" className="text-caption text-text-secondary">
                    {groupName(g.group)}
                  </span>
                  <span className="font-semibold tabular-nums">{amount(g.net)}</span>
                  <span className="text-caption text-text-secondary">
                    {tw('groupCount', { count: g.payment_count })}
                  </span>
                  <ul className="ms-3 flex flex-col text-caption text-text-secondary">
                    {g.methods.map((m) => (
                      <li key={m.payment_method} className="flex justify-between gap-2">
                        <span>{methodName(m.payment_method)}</span>
                        <span className="tabular-nums">
                          {amount(m.net)} · {tw('groupCount', { count: m.payment_count })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        </ChartTableToggle>
      </div>
    ) : null;

  const countText = data ? tw('value', { count: data.payment_count }) : '';
  const summary =
    variant === 'full' ? countText : [countText, topSentence].filter(Boolean).join(' · ');

  return (
    <WidgetCard
      title={variant === 'full' ? title : tw('compactTitle')}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(data && !empty ? { value: amount(data.net), summary } : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty ? { empty: { reason: tw('emptyReason') } } : {})}
      footer={
        data ? (
          <Link to="/reports/collections" className={linkClass}>
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {empty ? null : body}
    </WidgetCard>
  );
}

export default function CollectionTodayWidget({ variant }: WidgetProps) {
  const q = useCollectionToday();
  return (
    <CollectionTodayView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
