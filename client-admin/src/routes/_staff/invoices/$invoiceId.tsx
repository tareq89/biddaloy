import { InvoiceStatus, Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Field,
  FieldGrid,
  Input,
  RadioGroup,
  RadioGroupItem,
  RoutePending,
  Skeleton,
  StatusBadge,
  toast,
} from '@biddaloy/ui/components';
import {
  invoiceQueryOptions,
  useHasPermission,
  useInvoice,
  useInvoiceShares,
  usePrintInvoice,
  useRevokeShare,
  useSendInvoice,
  useShareInvoice,
  useStudent,
  type InvoiceWithSnapshot,
  type SendInvoiceMedium,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  formatDate,
  formatServerAmount,
  getPersistedPrintFormat,
  parseServerDate,
  persistPrintFormat,
  type InvoicePrintFormat,
} from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

/**
 * `/invoices/$invoiceId` — [8.9.9]'s Cmd/Ctrl+K palette and [8.10.6]'s
 * `/invoices` list both link here. `GET /invoices/:id` (`invoices.
 * controller.ts`) already existed before this route did — printing
 * (`invoices/:id/print`) has shipped since [#14] — so [8.10.6] only
 * fleshes out the fields this page renders, not a new backend surface.
 *
 * `line_items` isn't rendered: the generated `Invoice` schema types the
 * response field `Record<string, never> | null` (jsonb has no OpenAPI
 * shape for Swagger to infer), so reading it here would mean an unsound
 * cast for a field the acceptance criteria don't actually ask for.
 *
 * [16.5.5] adds the format radio / print / share / revoke / send actions
 * below. `snapshot.students` line items are still not rendered — 16.6's
 * multi-student invoice view is out of scope here, same reasoning as
 * `line_items` above.
 */
export const Route = createFileRoute('/_staff/invoices/$invoiceId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/$academicYearId.tsx`'s
      // identical comment for why.
      queryClient
        .ensureQueryData(invoiceQueryOptions(params.invoiceId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('fees'),
    ]),
  pendingComponent: InvoiceDetailPending,
  component: InvoiceDetailPage,
});

function InvoiceDetailPage() {
  const { invoiceId } = Route.useParams();
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const invoiceQuery = useInvoice(invoiceId);
  const canPrint = useHasPermission(Permission.INVOICE_PRINT);
  const canShare = useHasPermission(Permission.INVOICE_READ);

  const [format, setFormat] = React.useState<InvoicePrintFormat>(
    () => getPersistedPrintFormat() ?? 'a4',
  );
  const printInvoice = usePrintInvoice();

  const sharesQuery = useInvoiceShares(invoiceId);
  const shareInvoice = useShareInvoice();
  const revokeShare = useRevokeShare(invoiceId);
  const [revokeTargetId, setRevokeTargetId] = React.useState<string | null>(null);
  const liveShare = sharesQuery.data?.find((share) => share.revoked_at === null);

  const invoice = invoiceQuery.data as InvoiceWithSnapshot | undefined;
  const studentQuery = useStudent(invoice?.student.id);
  const sendInvoice = useSendInvoice(invoiceId);
  const [pendingMedium, setPendingMedium] = React.useState<SendInvoiceMedium | null>(null);

  const reachableGuardians = (studentQuery.data?.guardians ?? []).filter(
    (guardian) => guardian.notifications_enabled,
  );
  const primaryGuardians = reachableGuardians.filter((guardian) => guardian.is_primary_contact);
  const sendCandidates = primaryGuardians.length > 0 ? primaryGuardians : reachableGuardians;

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

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/invoices"
        className="inline-flex min-h-6 items-center self-start text-sm text-primary underline"
      >
        {t('invoiceDetail.back')}
      </Link>
      {invoiceQuery.isPending ? (
        <Skeleton className="h-7 w-48" />
      ) : invoiceQuery.isError || invoice === undefined ? (
        <ErrorState
          message={t('invoiceDetail.loadError')}
          retryLabel={t('invoiceDetail.retry')}
          onRetry={() => void invoiceQuery.refetch()}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold">{invoice.invoice_number}</h1>
                {invoice.kind === 'CREDIT_NOTE' && (
                  <span className="rounded-full border border-destructive px-2 py-0.5 text-xs text-destructive">
                    {t('invoiceDetail.creditNoteBadge')}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{invoice.student.full_name}</p>
            </div>
            <StatusBadge domain="invoice" status={invoice.status as InvoiceStatus} />
          </div>

          <FieldGrid className="text-sm">
            <Field label={t('invoiceDetail.issuedDate')}>
              {formatDate(parseServerDate(invoice.issued_date), regionConfig)}
            </Field>
            <Field label={t('invoiceDetail.dueDate')}>
              {formatDate(parseServerDate(invoice.due_date), regionConfig)}
            </Field>
            <Field label={t('invoiceDetail.taxAmount')}>
              {formatServerAmount(invoice.tax_amount, regionConfig)}
            </Field>
            <Field label={t('invoiceDetail.discountAmount')}>
              {formatServerAmount(invoice.discount_amount, regionConfig)}
            </Field>
            <Field label={t('invoiceDetail.totalAmount')}>
              <span className="font-medium">
                {formatServerAmount(invoice.total_amount, regionConfig)}
              </span>
            </Field>
          </FieldGrid>

          {invoice.notes !== null && (
            <p className="text-sm text-muted-foreground">{invoice.notes}</p>
          )}

          {(canPrint || canShare) && (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
              {canPrint && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">
                    {t('invoiceDetail.printFormat.label')}
                  </span>
                  <RadioGroup
                    value={format}
                    onValueChange={(value) => handleFormatChange(value as InvoicePrintFormat)}
                    className="flex flex-wrap gap-2"
                  >
                    {(['a4', 'pos80', 'pos58'] as const).map((option) => (
                      <label
                        key={option}
                        className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs has-[[data-state=checked]]:border-primary"
                      >
                        <RadioGroupItem value={option} />
                        {t(`invoiceDetail.printFormat.${option}`)}
                      </label>
                    ))}
                  </RadioGroup>
                  <Button
                    type="button"
                    className="self-start"
                    onClick={() => printInvoice(invoice.id, format)}
                  >
                    {t('invoiceDetail.print')}
                  </Button>
                </div>
              )}

              {canShare && (
                <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
                  {liveShare === undefined ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="self-start"
                      loading={shareInvoice.isPending}
                      onClick={() => shareInvoice.mutate(invoiceId)}
                    >
                      {t('invoiceDetail.share.create')}
                    </Button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input readOnly value={liveShare.url ?? ''} className="max-w-sm" />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleCopyLink(liveShare.url ?? '')}
                      >
                        {t('invoiceDetail.share.copyLink')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevokeTargetId(liveShare.id)}
                      >
                        {t('invoiceDetail.share.revoke')}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {canShare && (
                <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={sendCandidates.length === 0}
                    loading={sendInvoice.isPending}
                    onClick={() => startSend('WHATSAPP')}
                  >
                    {t('invoiceDetail.send.whatsapp')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={sendCandidates.length === 0}
                    loading={sendInvoice.isPending}
                    onClick={() => startSend('SMS')}
                  >
                    {t('invoiceDetail.send.sms')}
                  </Button>
                  {sendCandidates.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t('invoiceDetail.send.noGuardians')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Dialog
        open={revokeTargetId !== null}
        onOpenChange={(open) => !open && setRevokeTargetId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('invoiceDetail.share.revokeConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('invoiceDetail.share.revokeConfirmExplanation')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRevokeTargetId(null)}>
              {t('invoiceDetail.share.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={revokeShare.isPending}
              onClick={() => {
                if (revokeTargetId === null) return;
                revokeShare.mutate(revokeTargetId, {
                  onSuccess: () => {
                    toast.success(t('invoiceDetail.share.revoked'));
                    setRevokeTargetId(null);
                  },
                });
              }}
            >
              {t('invoiceDetail.share.revoke')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingMedium !== null}
        onOpenChange={(open) => !open && setPendingMedium(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('invoiceDetail.send.pickGuardian')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {sendCandidates.map((guardian) => (
              <Button
                key={guardian.id}
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => pendingMedium !== null && handleSend(pendingMedium, guardian.id)}
              >
                {guardian.full_name}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvoiceDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
