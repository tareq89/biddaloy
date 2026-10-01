/**
 * [32.3.7] Settings › Printers (D7, D21, D26, D27, D37). An admin adds printer
 * profiles, and calibrates each one: print a ruler sheet, measure it, enter the
 * offset. Like `BackupSection`, it takes no props (a printer belongs to the
 * caller's own school) and hides itself without `PRINT_TEMPLATE_MANAGE`.
 *
 * The calibration page is a test sheet, not a document, so it is NOT logged as
 * a print job (nothing is created on the server).
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  buildCalibrationDocument,
  openPrintWindow,
  toast,
} from '@biddaloy/ui/components';
import {
  useArchivePrinter,
  useHasPermission,
  usePrinters,
  type PrinterRow,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { PrinterFormDialog } from './printer-form-dialog';

/** CR80 card, landscape — what a card printer feeds. An office printer prints A4 (the builder decides). */
const CR80_MM = { widthMm: 85.6, heightMm: 54 };
const A4_MM = { widthMm: 210, heightMm: 297 };

export function PrintersSection() {
  const { t } = useTranslation('settings');
  const canManage = useHasPermission(Permission.PRINT_TEMPLATE_MANAGE);
  const printersQuery = usePrinters();
  const archive = useArchivePrinter();

  // `undefined` = closed; `null` = adding; a printer = editing it.
  const [dialog, setDialog] = React.useState<PrinterRow | null | undefined>(undefined);
  const [guideFor, setGuideFor] = React.useState<PrinterRow | undefined>(undefined);
  const [archiveTarget, setArchiveTarget] = React.useState<PrinterRow | undefined>(undefined);

  if (!canManage) return null;

  const printers = (printersQuery.data ?? []).filter((p) => p.archived_at === null);

  function handleCalibrate(printer: PrinterRow) {
    void openPrintWindow(
      // The page uses the printer's CURRENT offset and scale, so reprinting after a correction shows if it worked.
      () =>
        Promise.resolve(
          buildCalibrationDocument(
            {
              type: printer.printer_type,
              offsetXMm: printer.offset_x_mm,
              offsetYMm: printer.offset_y_mm,
              scale: printer.scale,
            },
            printer.printer_type === 'CARD' ? CR80_MM : A4_MM,
            { marginMm: printer.margin_left_mm },
          ),
        ),
      (error) =>
        toast.error(
          error.message === 'POPUP_BLOCKED'
            ? t('printers.popupBlocked')
            : t('printers.calibrateError'),
        ),
    );
    setGuideFor(printer);
  }

  function confirmArchive() {
    if (!archiveTarget) return;
    archive.mutate(archiveTarget.id, {
      onSuccess: () => toast.success(t('printers.archived')),
      // The global MutationCache only toasts a 403, so any other failure would be silent.
      onError: () => toast.error(t('printers.archiveError')),
      onSettled: () => setArchiveTarget(undefined),
    });
  }

  return (
    <Card id="printers-section" className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t('printers.title')}</h2>
        <Button type="button" size="sm" onClick={() => setDialog(null)}>
          {t('printers.add')}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{t('printers.explainer')}</p>

      {printersQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('printers.loadError')}
        </p>
      ) : printers.length === 0 && !printersQuery.isPending ? (
        <EmptyState
          title={t('printers.empty.title')}
          explanation={t('printers.empty.explanation')}
          action={{ label: t('printers.add'), onClick: () => setDialog(null) }}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {printers.map((printer) => (
            <li
              key={printer.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
            >
              <div className="flex flex-col">
                <span className="font-medium">{printer.name}</span>
                <span className="text-muted-foreground">
                  {t(`printers.type.${printer.printer_type}`)} ·{' '}
                  {t('printers.offsetValue', { x: printer.offset_x_mm, y: printer.offset_y_mm })} ·{' '}
                  {t(`printers.duplex.${printer.duplex_order}`)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleCalibrate(printer)}
                >
                  {t('printers.calibrate')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog(printer)}
                >
                  {t('printers.edit')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setArchiveTarget(printer)}
                >
                  {t('printers.archive')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {guideFor ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm"
        >
          <p className="font-medium">{t('printers.guide.title', { name: guideFor.name })}</p>
          <ol className="list-decimal ps-5">
            <li>{t('printers.guide.step1')}</li>
            <li>{t('printers.guide.step2')}</li>
            <li>{t('printers.guide.step3')}</li>
          </ol>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setDialog(guideFor);
                setGuideFor(undefined);
              }}
            >
              {t('printers.guide.editOffset')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setGuideFor(undefined)}>
              {t('printers.guide.close')}
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={archiveTarget !== undefined}
        onOpenChange={(open) => !open && setArchiveTarget(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('printers.archiveTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {t('printers.archiveConfirm', { name: archiveTarget?.name ?? '' })}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setArchiveTarget(undefined)}>
              {t('printers.form.cancel')}
            </Button>
            <Button type="button" loading={archive.isPending} onClick={confirmArchive}>
              {t('printers.archive')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PrinterFormDialog
        open={dialog !== undefined}
        onOpenChange={(open) => {
          if (!open) setDialog(undefined);
        }}
        printer={dialog ?? undefined}
      />
    </Card>
  );
}
