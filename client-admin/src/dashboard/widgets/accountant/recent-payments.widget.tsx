/**
 * [169.4-1886] `recent-payments` widget: full / compact. The server's total
 * counts only SUCCESS payments, so any other row says so on its own line;
 * otherwise the visible amounts would not add up to the total.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  formatRelativeAge,
  formatServerAmount,
  formatTime,
  renderDigits,
} from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.RECENT_PAYMENTS;

export type RecentPaymentsDto = components['schemas']['RecentPaymentsWidgetDto'];

const K = widgetKey;
const PHONE_ROWS = 3;

function useRecentPayments() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'recent-payments'],
    queryFn: async () =>
      (await apiClient.get<RecentPaymentsDto>('/dashboard/widgets/recent-payments')).data,
    ...dashboardQueryOptions,
  });
}

export interface RecentPaymentsViewProps {
  data?: RecentPaymentsDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function RecentPaymentsView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: RecentPaymentsViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const amount = (v: number) => formatServerAmount(v, region);
  const methodName = (m: string) => t(`widgets.paymentMethod.${m}`);
  const full = variant === 'full';
  const title = tw('title');
  const items = data?.items ?? [];
  const empty = !!data && items.length === 0;

  const latest = items[0];
  const sentence = latest
    ? tw('sentence', {
        ago: renderDigits(
          formatRelativeAge(new Date(latest.payment_date).getTime(), region.locale),
          region.numerals,
        ),
        method: methodName(latest.payment_method),
      })
    : undefined;

  const th = 'px-2 py-1 text-left font-semibold';
  const body =
    data && full && !empty ? (
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-border-subtle text-caption text-text-secondary">
              <th scope="col" className={th}>
                {tw('colStudent')}
              </th>
              <th scope="col" className={`${th} hidden md:table-cell`}>
                {tw('colClass')}
              </th>
              <th scope="col" className={`${th} text-right`}>
                {tw('colAmount')}
              </th>
              <th scope="col" className={th}>
                {tw('colMethod')}
              </th>
              <th scope="col" className={`${th} hidden md:table-cell`}>
                {tw('colTime')}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((p, i) => {
              const classText = [p.class_name, p.section_name].filter(Boolean).join(' ');
              const time = formatTime(p.payment_date, region);
              return (
                <tr
                  key={p.payment_id}
                  className={[
                    'border-b border-border-subtle align-top',
                    i >= PHONE_ROWS && 'hidden md:table-row',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <td className="px-2 py-1">
                    {p.student_name ?? tw('unknownStudent')}
                    <span className="block text-caption text-text-secondary md:hidden">
                      {[classText, time].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="hidden px-2 py-1 md:table-cell">{classText}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {amount(p.amount)}
                    {p.payment_status !== 'SUCCESS' ? (
                      <span className="block text-caption text-text-secondary">
                        {tw('notCounted', {
                          status: t(`common:status.payment.${p.payment_status}`),
                        })}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1">
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full bg-primary"
                      />
                      {methodName(p.payment_method)}
                    </span>
                  </td>
                  <td className="hidden px-2 py-1 md:table-cell">{time}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ) : null;

  return (
    <WidgetCard
      title={title}
      variant={full ? 'full' : 'compact'}
      {...(data && !empty
        ? {
            value: amount(data.total_of_shown),
            unit: tw('value', { count: items.length }),
            ...(sentence ? { summary: sentence } : {}),
          }
        : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      {...(empty ? { empty: { reason: tw('emptyReason') } } : {})}
      footer={
        data ? (
          <Link to="/payments" className="text-primary underline">
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {body}
    </WidgetCard>
  );
}

export default function RecentPaymentsWidget({ variant }: WidgetProps) {
  const q = useRecentPayments();
  return (
    <RecentPaymentsView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
