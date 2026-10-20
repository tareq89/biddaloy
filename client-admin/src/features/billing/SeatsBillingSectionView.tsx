import { SeatOrderStatus } from '@biddaloy/shared';
import {
  Button,
  DataTable,
  ErrorState,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import type { BillingSummary, SeatOrderDto } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatDate, formatNumber } from '@biddaloy/ui/utils';

import { SettingsSection } from '../../pages/settings/settings-layout';

import { daysUntil } from './billing-math';

const EXPIRING_DAYS = 30;

const STATUS_TONE = {
  PAID: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  REFUNDED: 'neutral',
} as const;

export interface SeatsBillingSectionViewProps {
  summary?: BillingSummary | undefined;
  loading: boolean;
  error?: boolean;
  /** Injected for stories and tests. */
  now?: Date;
  /** The order bKash returned for; shows whether it is paid, still being confirmed, or not paid. */
  returnOrderId?: string | undefined;
  payment?: 'success' | 'cancel' | 'failure' | 'error' | undefined;
  /** Polling stopped (2 minutes) with the order still PENDING. */
  pollTimedOut?: boolean;
  onBuy: () => void;
  onRetry: () => void;
  /** Opens the receipt of a paid order. */
  onReceipt?: (orderId: string) => void;
  receiptError?: boolean;
}

export function SeatsBillingSectionView({
  summary,
  loading,
  error,
  now = new Date(),
  returnOrderId,
  payment,
  pollTimedOut,
  onBuy,
  onRetry,
  onReceipt,
  receiptError,
}: SeatsBillingSectionViewProps) {
  const { t } = useTranslation('billing');
  const config = useRegionConfig();

  const columns: DataTableColumn<SeatOrderDto>[] = [
    {
      id: 'created',
      header: t('orders.date'),
      accessorFn: (o) => formatDate(o.created_at, config),
      card: 'subtitle',
    },
    {
      id: 'seats',
      header: t('orders.seats'),
      accessorFn: (o) => formatNumber(o.seats, config),
      align: 'end',
      card: 'title',
    },
    {
      id: 'months',
      header: t('orders.months'),
      accessorFn: (o) => formatNumber(o.months, config),
      align: 'end',
      card: 'field',
    },
    {
      id: 'amount',
      header: t('orders.amount'),
      accessorFn: (o) => formatCurrency(o.amount_paisa, config),
      align: 'end',
      card: 'field',
    },
    {
      id: 'status',
      header: t('orders.status'),
      accessorFn: (o) => (
        <StatusBadge tone={STATUS_TONE[o.status]} label={t(`orders.statusValue.${o.status}`)} />
      ),
      card: 'badge',
    },
    {
      id: 'receipt',
      header: t('orders.receipt'),
      accessorFn: (o) =>
        o.receipt_number && onReceipt ? (
          <Button
            variant="link"
            size="sm"
            aria-label={t('orders.downloadReceipt', { number: o.receipt_number })}
            onClick={() => onReceipt(o.id)}
          >
            {o.receipt_number}
          </Button>
        ) : null,
      card: 'field',
    },
  ];

  const returnOrder = returnOrderId
    ? summary?.orders.find((o) => o.id === returnOrderId)
    : undefined;
  const returnNotice = ((): { key: string; tone: 'paid' | 'bad' | 'info' } | undefined => {
    if (returnOrder?.status === SeatOrderStatus.PAID) return { key: 'paid', tone: 'paid' };
    if (payment === 'error' && !returnOrder) return { key: 'error', tone: 'bad' };
    if (!returnOrder) return undefined;
    if (
      returnOrder.status !== SeatOrderStatus.PENDING ||
      payment === 'cancel' ||
      payment === 'failure'
    ) {
      return { key: 'failed', tone: 'bad' };
    }
    return pollTimedOut ? { key: 'slow', tone: 'info' } : { key: 'pending', tone: 'info' };
  })();
  const inFreePeriod = summary ? now < new Date(summary.free_until) : false;
  const left = summary?.paid_until ? daysUntil(summary.paid_until, now) : null;
  const expired = !inFreePeriod && left !== null && left < 0;
  const expiring = !inFreePeriod && left !== null && left >= 0 && left <= EXPIRING_DAYS;

  return (
    <SettingsSection id="seats-billing-section" title={t('title')} description={t('description')}>
      {loading ? (
        <div aria-busy="true" className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="h-16 rounded-md bg-muted" />
          <div className="h-16 rounded-md bg-muted" />
          <div className="h-16 rounded-md bg-muted" />
        </div>
      ) : error || !summary ? (
        <div className="mt-4">
          <ErrorState
            message={t('loadError')}
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={onRetry}
          />
        </div>
      ) : (
        <>
          <dl className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-md bg-muted p-3">
              <dt className="text-caption text-text-secondary">{t('tiles.bought')}</dt>
              <dd className="text-h2 tabular-nums">{formatNumber(summary.seats_bought, config)}</dd>
            </div>
            <div className="rounded-md bg-muted p-3">
              <dt className="text-caption text-text-secondary">{t('tiles.used')}</dt>
              <dd className="text-h2 tabular-nums">{formatNumber(summary.seats_used, config)}</dd>
            </div>
            <div className="rounded-md bg-muted p-3">
              <dt className="text-caption text-text-secondary">
                {inFreePeriod ? t('tiles.freeUntil') : t('tiles.validity')}
              </dt>
              <dd className="text-h2">
                {inFreePeriod
                  ? formatDate(summary.free_until, config)
                  : summary.paid_until
                    ? formatDate(summary.paid_until, config)
                    : t('tiles.notPaid')}
              </dd>
            </div>
          </dl>

          {returnNotice && (
            <p
              role="status"
              className={`mt-3 ${returnNotice.tone === 'paid' ? 'text-status-paid-fg' : returnNotice.tone === 'bad' ? 'text-destructive' : 'text-text-secondary'}`}
            >
              {t(`return.${returnNotice.key}`)}
            </p>
          )}
          {inFreePeriod && (
            <p className="mt-3 text-text-secondary">
              {t('freeNotice', { date: formatDate(summary.free_until, config) })}
            </p>
          )}
          {expiring && summary.paid_until && (
            <p role="status" className="mt-3 text-status-due-fg">
              {t('expiringSoon', { date: formatDate(summary.paid_until, config) })}
            </p>
          )}
          {expired && (
            <p role="status" className="mt-3 text-destructive">
              {t('expired')}
            </p>
          )}

          <div className="mt-4">
            <Button onClick={onBuy} className="w-full md:w-auto">
              {t('buy.action')}
            </Button>
          </div>

          <h3 className="mt-6 text-h3">{t('orders.title')}</h3>
          {receiptError && (
            <p role="alert" className="mt-2 text-destructive">
              {t('orders.receiptFailed')}
            </p>
          )}
          <div className="mt-2">
            <DataTable
              tableId="billing-orders"
              caption={t('orders.caption')}
              columns={columns}
              data={summary.orders}
              getRowId={(o) => o.id}
              sorting={null}
              onSortingChange={() => undefined}
              page={1}
              pageSize={20}
              totalCount={summary.orders.length}
              onPageChange={() => undefined}
              loading={false}
              isFetching={false}
              emptyState={{
                title: t('orders.empty'),
                explanation: t('orders.emptyExplanation'),
              }}
            />
          </div>
        </>
      )}
    </SettingsSection>
  );
}
