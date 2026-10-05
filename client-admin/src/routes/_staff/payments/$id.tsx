/**
 * `/payments/$id` — [16.6.2] payment detail: allocations, invoice link,
 * collector/approver, reversal states and the **Reverse payment** action.
 * `GET /payments/:id` (`fees.controller.ts:330`, `payments-query.service.ts:150`)
 * already existed before this route did — see the published plan on #672.
 *
 * [31.4] `DetailShell` (no tabs) owns the header: the student name, status,
 * facts and actions. One primary — Print receipt; invoice / student links and
 * the danger action (Reverse payment, last) live in its More menu. Presentation
 * only: the reverse rules, dialog and approval flow are unchanged.
 */
import { Permission, PaymentStatus } from '@biddaloy/shared';
import {
  ErrorState,
  RoutePending,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableCount,
  toast,
} from '@biddaloy/ui/components';
import {
  openPrintableInvoice,
  useHasPermission,
  usePayment,
  type PaymentDetail,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, PageContainer, type DetailShellAction } from '@biddaloy/ui/shells';
import { formatDate, formatServerAmount, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Info, Printer, Receipt, Undo2, UserRound } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { ReversePaymentDialog } from './-reverse-payment-dialog';

export const Route = createFileRoute('/_staff/payments/$id')({
  loader: () => loadRouteNamespaces('payments', 'common'),
  pendingComponent: PaymentDetailPending,
  component: PaymentDetailPage,
});

const CARD_CLASS = 'rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5';
const LINK_CLASS =
  'inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2 md:min-h-0';

function PaymentDetailPage() {
  const { id } = Route.useParams();
  const { t } = useTranslation('payments');
  const regionConfig = useRegionConfig();
  const navigate = useNavigate();
  const paymentQuery = usePayment(id);
  const canReverse = useHasPermission(Permission.PAYMENT_REVERSE);
  const canPrint = useHasPermission(Permission.INVOICE_PRINT);
  const [reverseOpen, setReverseOpen] = React.useState(false);

  if (paymentQuery.isPending) {
    return (
      <PageContainer size="wide">
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-7 w-48" />
          <div className="flex flex-wrap gap-6">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-3 w-24 rounded-sm" />
            ))}
          </div>
          <Skeleton className="h-40 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (paymentQuery.isError) {
    return (
      <PageContainer size="wide">
        <ErrorState
          message={t('detail.loadError')}
          retryLabel={t('detail.retry')}
          onRetry={() => void paymentQuery.refetch()}
        />
      </PageContainer>
    );
  }

  const payment = paymentQuery.data;
  // The server comment on `payments-query.service.ts` — a deleted student comes back `null`.
  const student = payment.student as PaymentDetail['student'] | null;
  // A payment can only be reversed once, and a reversal itself is never
  // reversible — D10's "full only" rule. Hiding the action in both cases
  // avoids a confirm-then-409 round trip for a state visible on this page.
  const reversedById = payment.reversed_by_payment_id;
  const reversalOfId = payment.reversal_of_payment_id;
  const alreadyReversed = reversedById !== null;
  const isReversal = reversalOfId !== null;
  const invoice = payment.invoice;

  const actions: DetailShellAction[] = [
    {
      id: 'print',
      label: t('detail.printReceipt'),
      priority: 'primary',
      icon: <Printer aria-hidden />,
      allowed: invoice !== null && canPrint,
      onClick: () => {
        if (invoice !== null) {
          void openPrintableInvoice(invoice.id, () => toast.error(t('detail.printError')));
        }
      },
    },
    {
      id: 'view-invoice',
      label: t('detail.viewInvoice'),
      priority: 'tertiary',
      icon: <Receipt aria-hidden />,
      allowed: invoice !== null,
      onClick: () => {
        if (invoice !== null) {
          void navigate({ to: '/invoices/$invoiceId', params: { invoiceId: invoice.id } });
        }
      },
    },
    {
      id: 'view-student',
      label: t('detail.viewStudent'),
      priority: 'tertiary',
      icon: <UserRound aria-hidden />,
      allowed: student !== null,
      onClick: () => {
        if (student !== null) {
          void navigate({ to: '/students/$studentId', params: { studentId: student.id } });
        }
      },
    },
    {
      id: 'reverse',
      label: t('detail.reverseAction'),
      priority: 'destructive',
      icon: <Undo2 aria-hidden />,
      allowed:
        canReverse &&
        !alreadyReversed &&
        !isReversal &&
        (payment.payment_status as PaymentStatus) === PaymentStatus.SUCCESS,
      onClick: () => setReverseOpen(true),
    },
  ];

  const facts = [
    {
      label: t('detail.amount'),
      value: formatServerAmount(payment.total_amount, regionConfig),
    },
    {
      label: t('detail.date'),
      value: formatDate(parseServerDate(payment.payment_date), regionConfig),
    },
    { label: t('detail.method'), value: t(`record.method.methods.${payment.payment_method}`) },
    ...(payment.transaction_reference !== null
      ? [{ label: t('detail.reference'), value: payment.transaction_reference }]
      : []),
    { label: t('detail.collector'), value: payment.received_by?.full_name ?? t('detail.unknown') },
    { label: t('detail.approver'), value: payment.approved_by?.full_name ?? '—' },
    {
      label: t('detail.invoice'),
      value:
        invoice !== null ? (
          <Link to="/invoices/$invoiceId" params={{ invoiceId: invoice.id }} className={LINK_CLASS}>
            {invoice.invoice_number}
          </Link>
        ) : (
          t('detail.noInvoice')
        ),
    },
  ];

  return (
    <DetailShell
      name={student?.full_name ?? t('list.deletedStudent')}
      statusBadge={
        alreadyReversed ? (
          <StatusBadge tone="neutral" label={t('detail.reversedStatus')} />
        ) : (
          <StatusBadge domain="payment" status={payment.payment_status as PaymentStatus} />
        )
      }
      facts={facts}
      actions={actions}
    >
      {reversalOfId !== null && (
        <section className={`${CARD_CLASS} flex flex-col gap-2`}>
          <p className="flex items-center gap-2 font-medium">
            <Info className="size-5 text-status-partial-fg" aria-hidden="true" />
            {t('detail.reversalEntry')}
          </p>
          <Link to="/payments/$id" params={{ id: reversalOfId }} className={LINK_CLASS}>
            {t('detail.viewOriginal')}
          </Link>
        </section>
      )}

      {reversedById !== null && (
        <section className={`${CARD_CLASS} flex flex-col gap-2`}>
          <p className="flex items-center gap-2 font-medium">
            <Info className="size-5 text-status-partial-fg" aria-hidden="true" />
            {t('detail.reversedBanner')}
          </p>
          <Link to="/payments/$id" params={{ id: reversedById }} className={LINK_CLASS}>
            {t('detail.viewReversal')}
          </Link>
        </section>
      )}

      {payment.allocations.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
          <div className="p-4 md:p-5">
            <h2 className="text-h2">{t('detail.allocations.title')}</h2>
            <p className="mt-1 text-text-secondary">{t('detail.allocations.help')}</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('detail.allocations.columnFee')}</TableHead>
                <TableHead className="hidden md:table-cell">
                  {t('detail.allocations.columnPeriod')}
                </TableHead>
                <TableHead className="text-right">{t('detail.allocations.columnAmount')}</TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  {t('detail.allocations.columnDiscount')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payment.allocations.map((allocation) => {
                const period =
                  allocation.period_start !== null
                    ? formatDate(parseServerDate(allocation.period_start), regionConfig)
                    : '—';
                const discount = formatServerAmount(allocation.discount_amount, regionConfig);
                return (
                  <TableRow key={allocation.id}>
                    <TableCell>
                      <span className="font-medium">
                        {allocation.fee_name ?? t('detail.unknown')}
                      </span>
                      {/* Phone: period and discount drop under the fee name. */}
                      <span className="block text-text-secondary md:hidden">
                        {t('detail.allocations.phoneLine', { period, discount })}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{period}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatServerAmount(allocation.allocated_amount, regionConfig)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {discount}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="border-t border-border-subtle px-4 py-3">
            <TableCount total={payment.allocations.length} />
          </div>
        </section>
      )}

      {payment.remarks !== null && (
        <section className={CARD_CLASS}>
          <h2 className="text-h2">{t('detail.remarks')}</h2>
          <p className="mt-1">{payment.remarks}</p>
        </section>
      )}

      {reverseOpen && (
        <ReversePaymentDialog
          open={reverseOpen}
          onOpenChange={setReverseOpen}
          paymentId={payment.id}
        />
      )}
    </DetailShell>
  );
}

function PaymentDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
