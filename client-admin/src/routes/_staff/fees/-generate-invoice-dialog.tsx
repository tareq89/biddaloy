import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@biddaloy/ui/components';
import { useCreateInvoice, type FeeDueRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface GenerateInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: readonly FeeDueRow[];
  /** Called only when every request in the batch succeeded — the caller
   * (the dues queue) uses this to clear its own selection, same contract
   * as `SendReminderDialog`'s `onSent`. Not called on partial failure, so
   * a row that already got its invoice isn't silently deselected while
   * the dialog is still showing the failure. */
  onGenerated: () => void;
  /** Called on partial failure with the student ids that succeeded, so
   * the caller can drop just those from selection (avoids resubmitting
   * rows that already got an invoice on retry) and refresh the dues list,
   * without clearing the still-selected failed rows. */
  onPartialGenerate: (succeededStudentIds: readonly string[]) => void;
}

/**
 * [8.10.4]'s dues queue bulk "Generate Invoice" action. `POST /invoices`
 * is single-student — there's no bulk endpoint to call — so this loops
 * one request per selected row, building `line_items` from that row's
 * own `dues[]` (mirrors `invoices.service.ts`'s single-fee line-item
 * shape: "Fee for {month}/{year}"). No server-side atomicity across the
 * batch, so it reports exactly how many succeeded/failed rather than
 * implying an all-or-nothing outcome — same honesty
 * `SendReminderDialog`'s per-recipient reporting already commits to.
 *
 * Financial mutation, so no optimistic UI here either — this dialog only
 * ever renders a result once every `useCreateInvoice` call has settled.
 */
export function GenerateInvoiceDialog({
  open,
  onOpenChange,
  rows,
  onGenerated,
  onPartialGenerate,
}: GenerateInvoiceDialogProps) {
  const { t } = useTranslation('fees');
  const createInvoice = useCreateInvoice();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setError(null);
      setIsSubmitting(false);
    }
  }, [open]);

  const billableRows = rows.filter((row) => row.dues.length > 0);

  async function handleConfirm() {
    setIsSubmitting(true);
    setError(null);

    const results = await Promise.allSettled(
      billableRows.map((row) =>
        createInvoice.mutateAsync({
          student_id: row.student_id,
          line_items: row.dues.map((due) => ({
            description: `Fee for ${due.month}/${due.year}`,
            amount: due.balance,
            quantity: 1,
          })),
        }),
      ),
    );

    setIsSubmitting(false);
    const succeeded = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - succeeded;

    if (failed === 0) {
      onOpenChange(false);
      onGenerated();
      toast.success(t('dues.generateInvoiceDialog.successMessage', { count: succeeded }));
      return;
    }

    if (succeeded === 0) {
      setError(t('dues.generateInvoiceDialog.errorMessage'));
      return;
    }

    // Partial failure: keep the dialog open instead of clearing the whole
    // selection. `rows` is the caller's selection, so once it drops the
    // succeeded ids, `billableRows` above shrinks to just the still-failed
    // ones on the next render — Confirm then retries only those instead of
    // resubmitting rows that already got an invoice.
    const succeededStudentIds = billableRows
      .filter((_row, index) => results[index]?.status === 'fulfilled')
      .map((row) => row.student_id);
    onPartialGenerate(succeededStudentIds);
    setError(t('dues.generateInvoiceDialog.partialMessage', { succeeded, failed }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dues.generateInvoiceDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('dues.generateInvoiceDialog.description', { count: billableRows.length })}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button
            type="button"
            loading={isSubmitting}
            disabled={billableRows.length === 0}
            onClick={() => void handleConfirm()}
          >
            {isSubmitting
              ? t('dues.generateInvoiceDialog.generating')
              : t('dues.generateInvoiceDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
