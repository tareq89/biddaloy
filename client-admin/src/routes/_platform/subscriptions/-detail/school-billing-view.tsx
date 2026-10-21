/**
 * Epic 49 W4: one school's seats and orders, as the platform SUPER_ADMIN sees them. Presentational
 * only (stories and tests drive it); `school-billing.tsx` wires the query and the dialogs. Used by
 * the Subscriptions detail dialog and by the school detail page's Seats card.
 */
import { SeatOrderStatus } from '@biddaloy/shared';
import {
  Button,
  DataTable,
  ErrorState,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import type { PlatformSchoolBillingDetail, SeatOrderDto } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatDate, formatNumber } from '@biddaloy/ui/utils';

const STATUS_TONE = {
  PAID: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  REFUNDED: 'neutral',
} as const;

export interface SchoolBillingViewProps {
  detail?: PlatformSchoolBillingDetail | undefined;
  loading: boolean;
  error?: boolean;
  onRetry: () => void;
  onGrant: () => void;
  onRecordPayment: (order: SeatOrderDto) => void;
  onRevive: () => void;
}

export function SchoolBillingView({
  detail,
  loading,
  error,
  onRetry,
  onGrant,
  onRecordPayment,
  onRevive,
}: SchoolBillingViewProps) {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();

  if (loading) {
    return (
      <div aria-busy="true" className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (error || !detail) {
    return (
      <ErrorState
        message={t('subscriptions.panel.loadError')}
        retryLabel={t('subscriptions.panel.retry')}
        onRetry={onRetry}
      />
    );
  }

  const columns: DataTableColumn<SeatOrderDto>[] = [
    {
      id: 'created',
      header: t('subscriptions.panel.columnDate'),
      accessorFn: (o) => formatDate(o.created_at, config),
      card: 'subtitle',
    },
    {
      id: 'order',
      header: t('subscriptions.panel.columnOrder'),
      accessorFn: (o) =>
        t('subscriptions.panel.orderLine', {
          seats: formatNumber(o.seats, config),
          months: formatNumber(o.months, config),
        }),
      card: 'title',
    },
    {
      id: 'amount',
      header: t('subscriptions.panel.orderAmount'),
      accessorFn: (o) => formatCurrency(o.amount_paisa, config),
      align: 'end',
      card: 'field',
    },
    {
      id: 'method',
      header: t('subscriptions.panel.columnMethod'),
      accessorFn: (o) => (o.method ? t(`subscriptions.methods.${o.method}`) : '–'),
      card: 'field',
    },
    {
      id: 'status',
      header: t('subscriptions.panel.columnStatus'),
      accessorFn: (o) => (
        <StatusBadge
          tone={STATUS_TONE[o.status]}
          label={t(`subscriptions.orderStatus.${o.status}`)}
        />
      ),
      card: 'badge',
    },
  ];

  const isIdle = detail.status_reason === 'IDLE';
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md bg-muted p-3" data-testid="tile-bought">
          <dt className="text-caption text-text-secondary">{t('subscriptions.panel.bought')}</dt>
          <dd className="text-h2 tabular-nums">{formatNumber(detail.seats_entitled, config)}</dd>
        </div>
        <div className="rounded-md bg-muted p-3" data-testid="tile-used">
          <dt className="text-caption text-text-secondary">{t('subscriptions.panel.used')}</dt>
          <dd className="text-h2 tabular-nums">{formatNumber(detail.seats_used, config)}</dd>
        </div>
        <div className="rounded-md bg-muted p-3">
          <dt className="text-caption text-text-secondary">{t('subscriptions.panel.paidUntil')}</dt>
          <dd className="text-h2">
            {detail.paid_until
              ? formatDate(detail.paid_until, config)
              : t('subscriptions.neverPaid')}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        {!detail.deleted && (
          <Button type="button" variant="outline" onClick={onGrant}>
            {t('subscriptions.panel.grantSeats')}
          </Button>
        )}
        {(isIdle || detail.deleted) && (
          <Button type="button" variant="outline" onClick={onRevive}>
            {t('subscriptions.panel.revive')}
          </Button>
        )}
      </div>

      <h3 className="text-h3">{t('subscriptions.panel.ordersHeading')}</h3>
      <DataTable
        tableId="platform-school-orders"
        caption={t('subscriptions.panel.ordersHeading')}
        columns={columns}
        data={detail.orders}
        getRowId={(o) => o.id}
        sorting={null}
        onSortingChange={() => undefined}
        page={1}
        pageSize={100}
        totalCount={detail.orders.length}
        onPageChange={() => undefined}
        rowActions={(o) =>
          o.status === SeatOrderStatus.PENDING
            ? [
                {
                  intent: 'pay',
                  label: t('subscriptions.panel.recordPayment'),
                  display: 'text',
                  onClick: () => onRecordPayment(o),
                },
              ]
            : []
        }
        loading={false}
        isFetching={false}
        emptyState={{ title: t('subscriptions.panel.noOrders'), explanation: '' }}
      />
    </div>
  );
}
