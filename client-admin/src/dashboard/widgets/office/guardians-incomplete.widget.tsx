/**
 * [169.5-1903] `guardians-incomplete` widget (OFFICE_STAFF): counts only, no
 * guardian list. The link carries `?incomplete=1` so the list total equals the
 * card number (D33). Zero is a value, not an empty state.
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

export const widgetKey = DashboardWidgetKey.GUARDIANS_INCOMPLETE;

export type GuardiansIncompleteDto = components['schemas']['GuardiansIncompleteDto'];

const K = widgetKey;

function useGuardiansIncomplete() {
  return useQuery({
    queryKey: ['dashboard', 'widget', 'guardians-incomplete'],
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<GuardiansIncompleteDto>('/dashboard/widgets/guardians-incomplete', {
          signal,
        })
      ).data,
    ...dashboardQueryOptions,
  });
}

export interface GuardiansIncompleteViewProps {
  data?: GuardiansIncompleteDto | undefined;
  variant: WidgetProps['variant'];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function GuardiansIncompleteView({
  data,
  variant,
  loading = false,
  failed = false,
  onRetry,
}: GuardiansIncompleteViewProps) {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const tw = (key: string, opts: Record<string, unknown> = {}) => t(`widgets.${K}.${key}`, opts);
  const title = tw('title');

  if (variant === 'tile' && data) {
    return <StatTile label={tw('tileLabel')} value={formatNumber(data.incomplete_count, region)} />;
  }

  return (
    <WidgetCard
      title={title}
      variant={variant === 'full' ? 'full' : 'compact'}
      {...(data ? { value: tw('value', { count: data.incomplete_count }) } : {})}
      {...(data
        ? {
            summary:
              data.incomplete_count === 0
                ? tw('none')
                : tw('sentence', { total: formatNumber(data.total_count, region) }),
          }
        : {})}
      loading={loading}
      loadingLabel={t('states.loading', { title })}
      {...(failed && onRetry
        ? { error: { message: t('states.error'), retryLabel: t('states.retry'), onRetry } }
        : {})}
      footer={
        data ? (
          <Link
            to="/guardians"
            // ponytail: `incomplete` is added to the /guardians search schema by #1904
            // (epic/169/w5-ui-02-1904); cast drops once integration merges both.
            search={{ incomplete: 1 } as never}
            className="text-primary underline"
          >
            {tw('link')}
          </Link>
        ) : undefined
      }
    />
  );
}

export default function GuardiansIncompleteWidget({ variant }: WidgetProps) {
  const q = useGuardiansIncomplete();
  return (
    <GuardiansIncompleteView
      data={q.data}
      variant={variant}
      loading={q.isPending}
      failed={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
