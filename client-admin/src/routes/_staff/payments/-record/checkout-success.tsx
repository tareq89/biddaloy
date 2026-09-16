/**
 * [16.5.5] The real success view `record-payment-modal.tsx` lands on after
 * `POST /payments/checkout` succeeds — replaces the stopgap `navigate()`
 * to `/invoices/$invoiceId` that [16.4.4] shipped as a placeholder (see
 * that ticket's own comment at the old call site, now removed).
 *
 * Presentational: takes the `CheckoutResult` and two callbacks, renders
 * amount paid / change due / invoice number plus the same format-radio +
 * Print + Send actions as the invoice detail page
 * (`_staff/invoices/$invoiceId.tsx`), so a counter clerk can print or
 * WhatsApp the receipt without leaving the checkout dialog.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
  toast,
} from '@biddaloy/ui/components';
import {
  useHasPermission,
  useInvoiceSendCandidates,
  usePrintInvoice,
  useSendInvoice,
  type CheckoutResult,
  type SendInvoiceMedium,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  formatServerAmount,
  getPersistedPrintFormat,
  persistPrintFormat,
  type InvoicePrintFormat,
} from '@biddaloy/ui/utils';
import * as React from 'react';

export interface CheckoutSuccessProps {
  result: CheckoutResult;
  /** Every student this checkout paid for — `CheckoutResult` only carries
   * `payment.student` (the payment row's single "primary" student
   * column), so a multi-student (sibling) checkout's other students'
   * guardians would otherwise be missed when resolving who can receive
   * the receipt. The caller (`record-payment-modal.tsx`) already has this
   * as `selectedStudentIds` at checkout time. */
  studentIds: string[];
  onRecordAnother: () => void;
  /** Router-agnostic on purpose — this component has no route/link
   * dependency of its own, so it stays trivially testable/storyable.
   * The caller (`record-payment-modal.tsx`) wires this to
   * `navigate({ to: '/invoices/$invoiceId', ... })` plus closing the
   * dialog. */
  onViewInvoice: () => void;
}

export function CheckoutSuccess({
  result,
  studentIds,
  onRecordAnother,
  onViewInvoice,
}: CheckoutSuccessProps) {
  const { t } = useTranslation('payments');
  const { t: tFees } = useTranslation('fees');
  const regionConfig = useRegionConfig();

  const [format, setFormat] = React.useState<InvoicePrintFormat>(
    () => getPersistedPrintFormat() ?? 'a4',
  );
  const printInvoice = usePrintInvoice();
  const canPrint = useHasPermission(Permission.INVOICE_PRINT);
  const canSend = useHasPermission(Permission.INVOICE_READ);

  const sendInvoice = useSendInvoice(result.invoice_id);
  const [pendingMedium, setPendingMedium] = React.useState<SendInvoiceMedium | null>(null);

  const { sendCandidates } = useInvoiceSendCandidates(studentIds);

  function handleFormatChange(next: InvoicePrintFormat) {
    setFormat(next);
    persistPrintFormat(next);
  }

  function handleSend(medium: SendInvoiceMedium, guardianId?: string) {
    sendInvoice.mutate(
      { medium, ...(guardianId !== undefined ? { guardian_id: guardianId } : {}) },
      {
        onSuccess: () => {
          toast.success(tFees('invoiceDetail.send.sent'));
          setPendingMedium(null);
        },
        onError: (error) => {
          const message =
            error instanceof ApiError && error.message.includes('SMS_NO_CREDIT')
              ? tFees('invoiceDetail.send.smsNoCredit')
              : tFees('invoiceDetail.send.failed');
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-1 rounded-lg border border-border-subtle bg-card p-4 text-center">
        <h2 className="text-lg font-semibold">{t('record.success.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('record.success.invoiceNumber')}</p>
        <p className="text-sm font-medium">{result.invoice_number}</p>
        <p className="text-sm text-muted-foreground">{t('record.success.amountPaid')}</p>
        <p className="text-lg font-semibold">
          {formatServerAmount(result.payment.total_amount, regionConfig)}
        </p>
        {result.change_amount > 0 && (
          <div className="mt-2 rounded-md border border-primary bg-accent px-3 py-2">
            <p className="text-sm text-muted-foreground">{t('record.success.changeDue')}</p>
            <p className="text-xl font-bold">
              {formatServerAmount(result.change_amount, regionConfig)}
            </p>
          </div>
        )}
      </div>

      {canPrint && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{tFees('invoiceDetail.printFormat.label')}</span>
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
                {tFees(`invoiceDetail.printFormat.${option}`)}
              </label>
            ))}
          </RadioGroup>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => printInvoice(result.invoice_id, format)}
          >
            {tFees('invoiceDetail.print')}
          </Button>
        </div>
      )}

      {canSend && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={sendCandidates.length === 0}
            loading={sendInvoice.isPending}
            onClick={() => startSend('WHATSAPP')}
          >
            {tFees('invoiceDetail.send.whatsapp')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={sendCandidates.length === 0}
            loading={sendInvoice.isPending}
            onClick={() => startSend('SMS')}
          >
            {tFees('invoiceDetail.send.sms')}
          </Button>
        </div>
      )}

      <div className="flex justify-between gap-2">
        <Button type="button" onClick={onRecordAnother}>
          {t('record.success.recordAnother')}
        </Button>
        <Button type="button" variant="ghost" onClick={onViewInvoice}>
          {t('record.success.viewInvoice')}
        </Button>
      </div>

      <Dialog
        open={pendingMedium !== null}
        onOpenChange={(open) => !open && setPendingMedium(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tFees('invoiceDetail.send.pickGuardian')}</DialogTitle>
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
