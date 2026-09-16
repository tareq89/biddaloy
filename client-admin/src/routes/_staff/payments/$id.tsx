/**
 * `/payments/$id` — [16.6.2] payment detail: allocations, invoice link,
 * collector/approver, and (once #670 ships) the reversal panel + **Reverse
 * payment** button. `GET /payments/:id` (`fees.controller.ts:330`,
 * `payments-query.service.ts:150`) already existed before this route did —
 * see the published plan on #672 for what's hand-typed here ahead of #670's
 * `POST /payments/:id/reverse`.
 *
 * Follows `invoices/$invoiceId.tsx`'s "detail page + action dialog +
 * approval-gated mutation" shape: `usePayment` loads the row,
 * `useReversePayment` (wrapped in `useApprovedMutation`) drives the dialog.
 */
import { Permission, PaymentStatus } from '@biddaloy/shared';
import {
  Button,
  ErrorState,
  Field,
  FieldGrid,
  RoutePending,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useHasPermission, usePayment } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatServerAmount, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { ReversePaymentDialog } from './-reverse-payment-dialog';

export const Route = createFileRoute('/_staff/payments/$id')({
  loader: () => loadRouteNamespaces('payments', 'common'),
  pendingComponent: PaymentDetailPending,
  component: PaymentDetailPage,
});

function PaymentDetailPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation('payments');
  const regionConfig = useRegionConfig();
  const paymentQuery = usePayment(id);
  const canReverse = useHasPermission(Permission.PAYMENT_REVERSE);
  const [reverseOpen, setReverseOpen] = React.useState(false);

  const payment = paymentQuery.data;
  // A payment can only be reversed once, and a reversal itself is never
  // reversible — D10's "full only" rule. Hiding the button in both cases
  // avoids a confirm-then-409 round trip for a state visible on this page.
  const alreadyReversed = payment !== undefined && payment.reversed_by_payment_id !== null;
  const isReversal = payment !== undefined && payment.reversal_of_payment_id !== null;

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/payments"
        className="inline-flex min-h-6 items-center self-start text-sm text-primary underline"
      >
        {t('detail.back')}
      </Link>

      {paymentQuery.isPending ? (
        <Skeleton className="h-7 w-48" />
      ) : paymentQuery.isError ? (
        <ErrorState
          message={t('detail.loadError')}
          retryLabel={t('detail.retry')}
          onRetry={() => void paymentQuery.refetch()}
        />
      ) : payment === undefined ? null : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h1 className="text-lg font-semibold">{payment.student.full_name}</h1>
              {payment.transaction_reference !== null && (
                <p className="text-sm text-muted-foreground">{payment.transaction_reference}</p>
              )}
            </div>
            <StatusBadge domain="payment" status={payment.payment_status as PaymentStatus} />
          </div>

          {isReversal && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {t('detail.reversalOf', { id: payment.reversal_of_payment_id })}
            </p>
          )}

          <FieldGrid className="text-sm">
            <Field label={t('detail.amount')}>
              <span className="font-medium">
                {formatServerAmount(payment.total_amount, regionConfig)}
              </span>
            </Field>
            <Field label={t('detail.method')}>
              {t(`record.method.methods.${payment.payment_method}`)}
            </Field>
            <Field label={t('detail.date')}>
              {formatDate(parseServerDate(payment.payment_date), regionConfig)}
            </Field>
            <Field label={t('detail.collector')}>
              {payment.received_by?.full_name ?? t('detail.unknown')}
            </Field>
            <Field label={t('detail.invoice')}>
              {payment.invoice !== null ? (
                <Link
                  to="/invoices/$invoiceId"
                  params={{ invoiceId: payment.invoice.id }}
                  className="text-primary underline"
                >
                  {payment.invoice.invoice_number}
                </Link>
              ) : (
                t('detail.noInvoice')
              )}
            </Field>
          </FieldGrid>

          {payment.allocations.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t('detail.allocations.title')}</span>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('detail.allocations.columnFee')}</TableHead>
                    <TableHead>{t('detail.allocations.columnPeriod')}</TableHead>
                    <TableHead>{t('detail.allocations.columnAmount')}</TableHead>
                    <TableHead>{t('detail.allocations.columnDiscount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payment.allocations.map((allocation) => (
                    <TableRow key={allocation.id}>
                      <TableCell>{allocation.fee_name ?? t('detail.unknown')}</TableCell>
                      <TableCell>
                        {allocation.period_start !== null
                          ? formatDate(parseServerDate(allocation.period_start), regionConfig)
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {formatServerAmount(allocation.allocated_amount, regionConfig)}
                      </TableCell>
                      <TableCell>
                        {formatServerAmount(allocation.discount_amount, regionConfig)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {alreadyReversed && (
            <p className="rounded-md border border-border-subtle px-3 py-2 text-sm text-muted-foreground">
              {t('detail.reversedBanner')}
            </p>
          )}

          {canReverse &&
            !alreadyReversed &&
            !isReversal &&
            (payment.payment_status as PaymentStatus) === PaymentStatus.SUCCESS && (
              <Button
                type="button"
                variant="destructive"
                className="self-start"
                onClick={() => setReverseOpen(true)}
              >
                {t('detail.reverseAction')}
              </Button>
            )}

          {reverseOpen && (
            <ReversePaymentDialog
              open={reverseOpen}
              onOpenChange={setReverseOpen}
              paymentId={payment.id}
            />
          )}
        </>
      )}
    </div>
  );
}

function PaymentDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
