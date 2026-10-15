/**
 * [8.10.7.7.02] `print-queue` widget (OFFICE_STAFF, EXAM_CONTROLLER, ADMIN): documents still to
 * print, per kind, linking to the to-print tab. Counts only. The server count is the queue's own.
 */
import { DashboardWidgetKey } from '@biddaloy/shared';
import { apiClient, type components } from '@biddaloy/ui/api';
import { WidgetCard } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { dashboardQueryOptions } from '../../layout/use-dashboard-prefs';
import type { WidgetProps } from '../registry';

export const widgetKey = DashboardWidgetKey.PRINT_QUEUE;

export type PrintQueueWidgetDto = components['schemas']['PrintQueueWidgetDto'];

const K = widgetKey;

function usePrintQueue() {
  return useQuery({
    queryKey: ['dashboard', 'widget', K],
    queryFn: async ({ signal }) =>
      (await apiClient.get<PrintQueueWidgetDto>(`/dashboard/widgets/${K}`, { signal })).data,
    ...dashboardQueryOptions,
  });
}

export interface PrintQueueViewProps {
  data?: PrintQueueWidgetDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function PrintQueueView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: PrintQueueViewProps) {
  const { t } = useTranslation(['dashboard', 'printHistory']);
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) =>
    t(`dashboard:widgets.${K}.${key}`, opts);
  const title = tw('title');

  return (
    <WidgetCard
      title={title}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(data ? { value: tw('value', { count: data.total }) } : {})}
      {...(data && data.total === 0 ? { summary: tw('none') } : {})}
      loading={loading}
      loadingLabel={t('dashboard:states.loading', { title })}
      {...(failed && onRetry
        ? {
            error: {
              message: t('dashboard:states.error'),
              retryLabel: t('dashboard:states.retry'),
              onRetry,
            },
          }
        : {})}
      footer={
        data ? (
          <Link
            to="/reports/printables"
            search={{ tab: 'to-print' }}
            className="text-primary underline"
          >
            {tw('link')}
          </Link>
        ) : undefined
      }
    >
      {data && data.by_kind.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {data.by_kind.map((row) => (
            <li key={row.kind} className="flex items-center justify-between gap-2">
              <span>{t(`printHistory:kind.${row.kind}`)}</span>
              <span className="tabular-nums">{formatNumber(row.count, region)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </WidgetCard>
  );
}

export default function PrintQueueWidget({ variant }: WidgetProps) {
  const q = usePrintQueue();
  return (
    <PrintQueueView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
