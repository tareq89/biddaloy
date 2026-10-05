/**
 * [32.3.5] Reprint a past card exactly as it was printed (D59): same template
 * version and data, a new copy number and a new QR code. Reuses the preview's
 * `runPrint` and "did all print?" dialog, so it has the same guarantees (the job
 * is created before anything reaches the print tab; the answer is recorded).
 *
 * The ticket said to duplicate the ~20-line prepare here because it was written
 * for parallel lanes; the lanes were run one after another, so this imports the
 * one implementation instead of copying it.
 */
import { getActiveTenant } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@biddaloy/ui/components';
import {
  useConfirmPrintJob,
  usePrinters,
  usePrintAssets,
  type PrintHistoryRow,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { DidAllPrintDialog, type DidAllPrintItem } from '../preview/did-all-print-dialog';
import { runPrint } from '../preview/run-print';
import { useRememberedPrinter } from '../preview/use-remembered-printer';

export interface ReprintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: Pick<PrintHistoryRow, 'item_id' | 'job_id' | 'subject_label' | 'subject_type'>;
}

interface PendingJob {
  jobId: string;
  items: DidAllPrintItem[];
}

export function ReprintDialog({ open, onOpenChange, row }: ReprintDialogProps) {
  const { t, i18n } = useTranslation('printHistory');
  const tenantId = getActiveTenant() ?? '';
  const printersQuery = usePrinters();
  const fontAssets = usePrintAssets('FONT');
  const confirmJob = useConfirmPrintJob();
  const [rememberedId, remember] = useRememberedPrinter(tenantId);
  const [pickedId, setPickedId] = React.useState<string | undefined>(undefined);
  const [printing, setPrinting] = React.useState(false);
  const [pending, setPending] = React.useState<PendingJob | null>(null);

  const printers = (printersQuery.data ?? []).filter((p) => p.archived_at === null);
  const printer =
    printers.find((p) => p.id === pickedId) ??
    printers.find((p) => p.id === rememberedId) ??
    (printers.length === 1 ? printers[0] : undefined);

  async function handlePrint() {
    if (!printer) return;
    setPrinting(true);
    remember(printer.id);
    const result = await runPrint({
      request: { kind: 'reprint', jobId: row.job_id, itemIds: [row.item_id] },
      printer,
      assets: fontAssets.data ?? [],
      subjectType: row.subject_type,
      tenantId,
      lang: i18n.language,
      title: t('reprint.title', { name: row.subject_label }),
      onError: (error) =>
        toast.error(
          error.message === 'POPUP_BLOCKED' ? t('reprint.popupBlocked') : t('reprint.failed'),
        ),
    });
    setPrinting(false);
    if (result) {
      setPending({
        jobId: result.jobId,
        items: result.items.map((i) => ({ id: i.itemId, label: i.label })),
      });
    }
  }

  if (pending) {
    return (
      <DidAllPrintDialog
        key={pending.jobId}
        open={open}
        items={pending.items}
        onConfirm={async (failedItemIds) => {
          await confirmJob.mutateAsync({ jobId: pending.jobId, failedItemIds });
        }}
        onReprintFailed={(failedItemIds) => {
          const jobId = pending.jobId;
          setPending(null);
          void runPrint({
            request: { kind: 'reprint', jobId, itemIds: failedItemIds },
            printer: printer as NonNullable<typeof printer>,
            assets: fontAssets.data ?? [],
            subjectType: row.subject_type,
            tenantId,
            lang: i18n.language,
            title: t('reprint.title', { name: row.subject_label }),
            onError: () => toast.error(t('reprint.failed')),
          }).then((result) => {
            if (result) {
              setPending({
                jobId: result.jobId,
                items: result.items.map((i) => ({ id: i.itemId, label: i.label })),
              });
            }
          });
        }}
        onContinue={() => {
          setPending(null);
          onOpenChange(false);
        }}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('reprint.title', { name: row.subject_label })}</DialogTitle>
        </DialogHeader>

        <p className="text-sm">{t('reprint.explain')}</p>

        {printers.length === 0 && !printersQuery.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('reprint.noPrinter')}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('reprint.printer')}</span>
            <Select value={printer?.id ?? ''} onValueChange={setPickedId}>
              <SelectTrigger aria-label={t('reprint.printer')}>
                <SelectValue placeholder={t('reprint.choosePrinter')} />
              </SelectTrigger>
              <SelectContent>
                {printers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('reprint.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!printer}
            loading={printing}
            onClick={() => void handlePrint()}
          >
            {t('reprint.print')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
