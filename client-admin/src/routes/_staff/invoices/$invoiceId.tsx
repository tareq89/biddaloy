import { InvoiceStatus, Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  RoutePending,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@biddaloy/ui/components';
import {
  invoiceQueryOptions,
  useHasPermission,
  useInvoice,
  useInvoiceSendCandidates,
  useInvoiceShares,
  usePrintInvoice,
  useRevokeShare,
  useSendInvoice,
  useShareInvoice,
  type InvoiceWithSnapshot,
  type SendInvoiceMedium,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, PageContainer } from '@biddaloy/ui/shells';
import {
  formatDate,
  formatMonth,
  formatServerAmount,
  getPersistedPrintFormat,
  parseServerDate,
  persistPrintFormat,
  type InvoicePrintFormat,
} from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Link2, MessageCircle, MessageSquare, Printer } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';
import { optionRowClass } from '../payments/-record/option-row';

/**
 * `/invoices/$invoiceId` — [8.9.9]'s Cmd/Ctrl+K palette and [8.10.6]'s
 * `/invoices` list both link here. `GET /invoices/:id` (`invoices.
 * controller.ts`) already existed before this route did — printing
 * (`invoices/:id/print`) has shipped since [#14].
 *
 * [31.4] Redesign: `DetailShell` header (number, status, facts with links to
 * the payment and, for a credit note, the original invoice), one card per
 * student of `snapshot.students` with a totals band, and an aside with the
 * Print and Send/Share cards. Presentation only: print, send, share and
 * revoke behave as before.
 */
export const Route = createFileRoute('/_staff/invoices/$invoiceId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/$academicYearId.tsx`'s
      // identical comment for why.
      queryClient
        .ensureQueryData(invoiceQueryOptions(params.invoiceId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('fees', 'payments'),
    ]),
  pendingComponent: InvoiceDetailPending,
  component: InvoiceDetailPage,
});

const CARD_CLASS = 'rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5';
const LINK_CLASS =
  'inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2 md:min-h-0';

function InvoiceDetailPage() {
  const { invoiceId } = Route.useParams();
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const invoiceQuery = useInvoice(invoiceId);
  const canPrint = useHasPermission(Permission.INVOICE_PRINT);
  const canShare = useHasPermission(Permission.INVOICE_READ);
  const formatLegendId = React.useId();

  const [format, setFormat] = React.useState<InvoicePrintFormat>(
    () => getPersistedPrintFormat() ?? 'a4',
  );
  const printInvoice = usePrintInvoice();

  const sharesQuery = useInvoiceShares(invoiceId);
  const shareInvoice = useShareInvoice();
  const revokeShare = useRevokeShare(invoiceId);
  const [revokeTargetId, setRevokeTargetId] = React.useState<string | null>(null);
  const liveShare = sharesQuery.data?.find((share) => share.revoked_at === null);
  // The raw share URL only ever exists in `POST /invoices/:id/share`'s own
  // response (`CreateInvoiceShareResult`) — `GET /invoices/:id/share`
  // (`useInvoiceShares`, which `liveShare` above reads) only ever returns
  // the stored token *hash* (`invoices.controller.ts`'s `listTokens`), by
  // design: the server can't recover a URL it never kept the raw token
  // for. So this only ever holds a value right after a fresh
  // `shareInvoice.mutate()` in *this* session, cleared on reload or once
  // the share is revoked — there is no bug to "fix" that makes it survive
  // a reload; the raw token is genuinely gone once the response that
  // minted it is.
  const [createdShareUrl, setCreatedShareUrl] = React.useState<string | null>(null);

  const invoice = invoiceQuery.data as InvoiceWithSnapshot | undefined;
  const sendInvoice = useSendInvoice(invoiceId);
  const [pendingMedium, setPendingMedium] = React.useState<SendInvoiceMedium | null>(null);

  // [#664 review] Every student on the invoice, not just `invoice.student`
  // — a multi-student (sibling) invoice's guardians linked only to a
  // non-primary student were previously missed entirely.
  const { sendCandidates } = useInvoiceSendCandidates(
    invoice?.snapshot.students.map((s) => s.id) ?? [],
  );

  function handleFormatChange(next: InvoicePrintFormat) {
    setFormat(next);
    persistPrintFormat(next);
  }

  function handleSend(medium: SendInvoiceMedium, guardianId?: string) {
    sendInvoice.mutate(
      { medium, ...(guardianId !== undefined ? { guardian_id: guardianId } : {}) },
      {
        onSuccess: () => {
          toast.success(t('invoiceDetail.send.sent'));
          setPendingMedium(null);
        },
        onError: (error) => {
          const message =
            error instanceof ApiError && error.message.includes('SMS_NO_CREDIT')
              ? t('invoiceDetail.send.smsNoCredit')
              : t('invoiceDetail.send.failed');
          toast.error(message);
        },
      },
    );
  }

  function startSend(medium: SendInvoiceMedium) {
    if (sendCandidates.length === 0) return;
    if (sendCandidates.length === 1) {
      handleSend(medium);
      return;
    }
    setPendingMedium(medium);
  }

  async function handleCopyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('invoiceDetail.share.copied'));
    } catch {
      toast.error(t('invoiceDetail.share.copyFailed'));
    }
  }

  if (invoiceQuery.isPending) {
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
          <Skeleton className="h-40 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (invoiceQuery.isError || invoice === undefined) {
    return (
      <PageContainer size="wide">
        <ErrorState
          message={t('invoiceDetail.loadError')}
          retryLabel={t('invoiceDetail.retry')}
          onRetry={() => void invoiceQuery.refetch()}
        />
      </PageContainer>
    );
  }

  const { snapshot } = invoice;
  const settled = invoice.status === 'PAID' || invoice.status === 'CANCELLED';
  const lastStudentIndex = snapshot.students.length - 1;

  // Computed first: a `}` inside a template literal nested in the `t()` call below
  // cuts `check:i18n`'s key regex short.
  const methodLabel = t(`record.method.methods.${snapshot.payment.method}`, { ns: 'payments' });

  const facts = [
    {
      label: t('invoiceDetail.student', { ns: 'payments' }),
      value: `${invoice.student.full_name} · ${invoice.student.registration_number}`,
    },
    {
      label: t('invoiceDetail.issuedDate'),
      value: formatDate(parseServerDate(invoice.issued_date), regionConfig),
    },
    ...(settled
      ? []
      : [
          {
            label: t('invoiceDetail.dueDate'),
            value: formatDate(parseServerDate(invoice.due_date), regionConfig),
          },
        ]),
    {
      label: t('invoiceDetail.totalAmount'),
      value: formatServerAmount(invoice.total_amount, regionConfig),
    },
    ...(invoice.payment_id !== null
      ? [
          {
            label: t('invoiceDetail.payment', { ns: 'payments' }),
            value: (
              <Link to="/payments/$id" params={{ id: invoice.payment_id }} className={LINK_CLASS}>
                {t('invoiceDetail.paymentValue', {
                  method: methodLabel,
                  date: formatDate(parseServerDate(snapshot.payment.payment_date), regionConfig),
                  ns: 'payments',
                })}
              </Link>
            ),
          },
        ]
      : []),
    ...(invoice.kind === 'CREDIT_NOTE' && invoice.related_invoice_id != null
      ? [
          {
            label: t('invoiceDetail.originalInvoice', { ns: 'payments' }),
            value: (
              <Link
                to="/invoices/$invoiceId"
                params={{ invoiceId: invoice.related_invoice_id }}
                className={LINK_CLASS}
              >
                {/* The server's findOne does not load the relation, so it can be absent. */}
                {invoice.related_invoice?.invoice_number ??
                  t('invoiceDetail.originalInvoice', { ns: 'payments' })}
              </Link>
            ),
          },
        ]
      : []),
  ];

  const totalsBand = (
    <dl className="space-y-2 border-t border-border-subtle bg-muted p-4 md:px-5">
      <div className="flex justify-between gap-4">
        <dt>{t('invoiceDetail.totals.billed', { ns: 'payments' })}</dt>
        <dd className="tabular-nums">{formatServerAmount(snapshot.totals.billed, regionConfig)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt>{t('invoiceDetail.totals.discount', { ns: 'payments' })}</dt>
        <dd className="tabular-nums">
          {formatServerAmount(snapshot.totals.discount, regionConfig)}
        </dd>
      </div>
      {invoice.tax_amount > 0 && (
        <div className="flex justify-between gap-4">
          <dt>{t('invoiceDetail.totals.tax', { ns: 'payments' })}</dt>
          <dd className="tabular-nums">{formatServerAmount(invoice.tax_amount, regionConfig)}</dd>
        </div>
      )}
      {snapshot.totals.wallet_used > 0 && (
        <div className="flex justify-between gap-4">
          <dt>{t('invoiceDetail.totals.wallet', { ns: 'payments' })}</dt>
          <dd className="tabular-nums">
            {formatServerAmount(snapshot.totals.wallet_used, regionConfig)}
          </dd>
        </div>
      )}
      <div className="flex justify-between gap-4 border-t border-border-subtle pt-2">
        <dt className="font-medium">{t('invoiceDetail.totals.paid', { ns: 'payments' })}</dt>
        <dd className="text-h3 tabular-nums">
          {formatServerAmount(snapshot.totals.paid, regionConfig)}
        </dd>
      </div>
      {snapshot.totals.change > 0 && (
        <div className="flex justify-between gap-4">
          <dt>{t('invoiceDetail.totals.change', { ns: 'payments' })}</dt>
          <dd className="tabular-nums">
            {formatServerAmount(snapshot.totals.change, regionConfig)}
          </dd>
        </div>
      )}
    </dl>
  );

  return (
    <DetailShell
      name={invoice.invoice_number}
      statusBadge={
        <>
          <StatusBadge domain="invoice" status={invoice.status as InvoiceStatus} />
          {invoice.kind === 'CREDIT_NOTE' && (
            <StatusBadge tone="neutral" label={t('invoiceDetail.creditNote', { ns: 'payments' })} />
          )}
        </>
      }
      facts={facts}
    >
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="order-2 min-w-0 flex-1 space-y-6 md:order-1">
          {snapshot.students.map((student, index) => (
            <section
              key={student.id}
              className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1"
            >
              <div className="p-4 md:p-5">
                <h2 className="text-h2">{student.full_name}</h2>
                <p className="mt-1 text-text-secondary">
                  {student.class_name !== null
                    ? `${student.class_name} · ${student.registration_number}`
                    : student.registration_number}
                </p>
              </div>
              <Table>
                <caption className="sr-only">
                  {t('invoiceDetail.lines.caption', { name: student.full_name, ns: 'payments' })}
                </caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('invoiceDetail.lines.fee', { ns: 'payments' })}</TableHead>
                    <TableHead className="hidden md:table-cell">
                      {t('invoiceDetail.lines.period', { ns: 'payments' })}
                    </TableHead>
                    <TableHead className="hidden text-right md:table-cell">
                      {t('invoiceDetail.lines.billed', { ns: 'payments' })}
                    </TableHead>
                    <TableHead className="hidden text-right md:table-cell">
                      {t('invoiceDetail.lines.discount', { ns: 'payments' })}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('invoiceDetail.lines.paidNow', { ns: 'payments' })}
                    </TableHead>
                    <TableHead className="hidden text-right md:table-cell">
                      {t('invoiceDetail.lines.balance', { ns: 'payments' })}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {student.lines.map((line, lineIndex) => {
                    const period =
                      line.period_start !== undefined
                        ? formatMonth(line.period_start, regionConfig)
                        : line.period_label || '—';
                    const billed = formatServerAmount(line.amount, regionConfig);
                    return (
                      <TableRow key={`${line.fee_name}-${lineIndex}`}>
                        <TableCell>
                          <span className="font-medium">{line.fee_name}</span>
                          {/* Phone: period and bill drop under the fee name. */}
                          <span className="block text-text-secondary md:hidden">
                            {t('invoiceDetail.lines.phoneLine', { period, billed, ns: 'payments' })}
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{period}</TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {billed}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {formatServerAmount(line.discount, regionConfig)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatServerAmount(line.paid_this_time, regionConfig)}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {formatServerAmount(line.balance_after, regionConfig)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {index === lastStudentIndex && totalsBand}
            </section>
          ))}

          {snapshot.students.length === 0 && (
            <section className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
              {totalsBand}
            </section>
          )}

          {invoice.notes !== null && (
            <section className={CARD_CLASS}>
              <h2 className="text-h2">{t('invoiceDetail.notes', { ns: 'payments' })}</h2>
              <p className="mt-1">{invoice.notes}</p>
            </section>
          )}
        </div>

        {(canPrint || canShare) && (
          <div className="order-1 space-y-6 md:order-2 md:w-80 md:shrink-0">
            {canPrint && (
              <section className={CARD_CLASS}>
                <h2 className="text-h2">{t('invoiceDetail.printTitle', { ns: 'payments' })}</h2>
                <div className="mt-3 flex flex-col gap-2">
                  <span id={formatLegendId} className="text-sm font-medium">
                    {t('printFormat.label', { ns: 'payments' })}
                  </span>
                  <RadioGroup
                    value={format}
                    onValueChange={(value) => handleFormatChange(value as InvoicePrintFormat)}
                    aria-labelledby={formatLegendId}
                    className="grid gap-2"
                  >
                    <label className={optionRowClass}>
                      <RadioGroupItem value="a4" />
                      {t('printFormat.a4', { ns: 'payments' })}
                    </label>
                    <label className={optionRowClass}>
                      <RadioGroupItem value="pos80" />
                      {t('printFormat.pos80', { ns: 'payments' })}
                    </label>
                    <label className={optionRowClass}>
                      <RadioGroupItem value="pos58" />
                      {t('printFormat.pos58', { ns: 'payments' })}
                    </label>
                  </RadioGroup>
                </div>
                <Button
                  type="button"
                  className="mt-4 h-11 w-full"
                  onClick={() => printInvoice(invoice.id, format)}
                >
                  <Printer aria-hidden="true" />
                  {t('invoiceDetail.printAction', { ns: 'payments' })}
                </Button>
              </section>
            )}

            {canShare && (
              <section className={CARD_CLASS}>
                <h2 className="text-h2">{t('invoiceDetail.sendTitle', { ns: 'payments' })}</h2>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={sendCandidates.length === 0}
                    loading={sendInvoice.isPending}
                    onClick={() => startSend('WHATSAPP')}
                  >
                    <MessageCircle aria-hidden="true" />
                    {t('invoiceDetail.sendWhatsapp', { ns: 'payments' })}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={sendCandidates.length === 0}
                    loading={sendInvoice.isPending}
                    onClick={() => startSend('SMS')}
                  >
                    <MessageSquare aria-hidden="true" />
                    {t('invoiceDetail.sendSms', { ns: 'payments' })}
                  </Button>
                </div>
                {sendCandidates.length === 0 && (
                  <p className="mt-2 text-label text-text-secondary">
                    {t('invoiceDetail.send.noGuardians')}
                  </p>
                )}

                <div className="mt-4 flex flex-col gap-2 border-t border-border-subtle pt-4">
                  <h3 className="text-h3">{t('invoiceDetail.shareTitle', { ns: 'payments' })}</h3>
                  <p className="text-text-secondary">
                    {t('invoiceDetail.shareHelp', { ns: 'payments' })}
                  </p>
                  {liveShare === undefined ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full"
                      loading={shareInvoice.isPending}
                      onClick={() => {
                        shareInvoice.reset();
                        // `useShareInvoice`'s mutation resolves to
                        // `{ invoiceId, result }`, not the create response
                        // directly — see its own doc comment.
                        shareInvoice.mutate(invoiceId, {
                          onSuccess: ({ result }) => setCreatedShareUrl(result.url),
                        });
                      }}
                    >
                      <Link2 aria-hidden="true" />
                      {t('invoiceDetail.shareCreate', { ns: 'payments' })}
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {createdShareUrl !== null ? (
                        <>
                          <Label htmlFor="invoice-share-url">
                            {t('invoiceDetail.share.urlLabel')}
                          </Label>
                          <Input id="invoice-share-url" readOnly value={createdShareUrl} />
                          <Button
                            type="button"
                            variant="outline"
                            className="h-11 w-full"
                            onClick={() => void handleCopyLink(createdShareUrl)}
                          >
                            {t('invoiceDetail.share.copyLink')}
                          </Button>
                        </>
                      ) : (
                        <p className="text-text-secondary">{t('invoiceDetail.share.linkHidden')}</p>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11 w-full text-destructive"
                        onClick={() => {
                          revokeShare.reset();
                          setRevokeTargetId(liveShare.id);
                        }}
                      >
                        {t('invoiceDetail.shareRevoke', { ns: 'payments' })}
                      </Button>
                    </div>
                  )}
                  {(shareInvoice.isError || revokeShare.isError) && (
                    <p role="alert" className="text-sm text-destructive">
                      {shareInvoice.isError
                        ? t('invoiceDetail.shareFailed', { ns: 'payments' })
                        : t('invoiceDetail.revokeFailed', { ns: 'payments' })}
                    </p>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={revokeTargetId !== null}
        onOpenChange={(open) => !open && setRevokeTargetId(null)}
        tone="danger"
        title={t('invoiceDetail.shareRevokeTitle', { ns: 'payments' })}
        description={t('invoiceDetail.share.revokeConfirmExplanation')}
        confirmLabel={t('invoiceDetail.shareRevoke', { ns: 'payments' })}
        busy={revokeShare.isPending}
        onConfirm={() => {
          if (revokeTargetId === null) return;
          revokeShare.mutate(revokeTargetId, {
            onSuccess: () => {
              toast.success(t('invoiceDetail.share.revoked'));
              setCreatedShareUrl(null);
            },
            // The failure line lives in the card behind the dialog, so close the
            // dialog on both outcomes: the user must see it.
            onSettled: () => setRevokeTargetId(null),
          });
        }}
      />

      <Dialog
        open={pendingMedium !== null}
        onOpenChange={(open) => !open && setPendingMedium(null)}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t('invoiceDetail.send.pickGuardian')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {sendCandidates.map((guardian) => (
              <Button
                key={guardian.id}
                type="button"
                variant="outline"
                className="h-11 justify-start"
                disabled={sendInvoice.isPending}
                onClick={() => pendingMedium !== null && handleSend(pendingMedium, guardian.id)}
              >
                {guardian.full_name}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </DetailShell>
  );
}

function InvoiceDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
