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
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  buildCalibrationDocument,
  openPrintWindow,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useArchivePrinter,
  useHasPermission,
  usePrinters,
  type PrinterRow,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { PencilIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

import { PrinterFormDialog } from './printer-form-dialog';
import { SettingsSection } from './settings-layout';

/** CR80 card, landscape — what a card printer feeds. An office printer prints A4 (the builder decides). */
const CR80_MM = { widthMm: 85.6, heightMm: 54 };
const A4_MM = { widthMm: 210, heightMm: 297 };

/** `1.5`, `-0.5`, `2`: the fewest decimals (0-2) that keep the saved value exact. */
function formatMm(value: number, config: RegionConfig): string {
  const decimals = Number.isInteger(value) ? 0 : Number.isInteger(value * 10) ? 1 : 2;
  return formatNumber(value, config, { decimals });
}

export function PrintersSection() {
  const { t } = useTranslation('settings');
  const canManage = useHasPermission(Permission.PRINT_TEMPLATE_MANAGE);
  const regionConfig = useRegionConfig();
  const printersQuery = usePrinters();
  const archive = useArchivePrinter();

  // `undefined` = closed; `null` = adding; a printer = editing it.
  const [dialog, setDialog] = React.useState<PrinterRow | null | undefined>(undefined);
  // The calibration guide opens the dialog with the measurements already showing.
  const [dialogAdvanced, setDialogAdvanced] = React.useState(false);
  const [guideFor, setGuideFor] = React.useState<PrinterRow | undefined>(undefined);
  const [archiveTarget, setArchiveTarget] = React.useState<PrinterRow | undefined>(undefined);

  if (!canManage) return null;

  const printers = (printersQuery.data ?? []).filter((p) => p.archived_at === null);

  function openDialog(printer: PrinterRow | null, advanced = false) {
    setDialogAdvanced(advanced);
    setDialog(printer);
  }

  const columns: DataTableColumn<PrinterRow>[] = [
    { id: 'name', header: t('printers.columns.name'), accessorFn: (p) => p.name, card: 'title' },
    {
      id: 'type',
      header: t('printers.columns.type'),
      accessorFn: (p) => t(`printers.type.${p.printer_type}`),
      card: 'subtitle',
    },
    {
      id: 'duplex',
      header: t('printers.columns.duplex'),
      accessorFn: (p) => t(`printers.duplex.${p.duplex_order}`),
      card: 'field',
    },
    {
      id: 'offset',
      header: t('printers.columns.offset'),
      accessorFn: (p) =>
        t('printers.offsetValue', {
          x: formatMm(p.offset_x_mm, regionConfig),
          y: formatMm(p.offset_y_mm, regionConfig),
        }),
      card: 'field',
    },
  ];

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
    <SettingsSection
      id="printers-section"
      title={t('printers.title')}
      description={t('printers.explainer')}
      // With no printers the EmptyState's own button is the only add action.
      actions={
        printers.length > 0 ? (
          <Button type="button" className="w-full md:w-auto" onClick={() => openDialog(null)}>
            <PlusIcon aria-hidden="true" />
            {t('printers.add')}
          </Button>
        ) : undefined
      }
    >
      <div className="mt-4">
        {printersQuery.isError ? (
          <ErrorState
            message={t('printers.loadError')}
            onRetry={() => void printersQuery.refetch()}
          />
        ) : printers.length === 0 && !printersQuery.isPending ? (
          <EmptyState
            title={t('printers.empty.title')}
            explanation={t('printers.empty.explanation')}
            action={{ label: t('printers.add'), onClick: () => openDialog(null) }}
          />
        ) : (
          <DataTable
            tableId="printers"
            caption={t('printers.listCaption')}
            paginated={false}
            data={printers}
            totalCount={printers.length}
            getRowId={(p) => p.id}
            sorting={null}
            onSortingChange={() => undefined}
            loading={printersQuery.isPending}
            columns={columns}
            rowActions={(p) => [
              {
                intent: 'print',
                label: t('printers.calibrate'),
                onClick: () => handleCalibrate(p),
              },
              { intent: 'edit', label: t('printers.edit'), onClick: () => openDialog(p) },
              {
                intent: 'archive',
                label: t('printers.archive'),
                onClick: () => setArchiveTarget(p),
              },
            ]}
          />
        )}
      </div>

      {guideFor ? (
        <div role="status" className="mt-4 flex flex-col gap-2 rounded-md bg-muted p-4">
          <h3 className="text-h3">{t('printers.guide.title', { name: guideFor.name })}</h3>
          <ol className="list-decimal space-y-1 ps-5">
            <li>{t('printers.guide.step1')}</li>
            <li>{t('printers.guide.step2')}</li>
            <li>{t('printers.guide.step3')}</li>
          </ol>
          <div className="flex flex-col gap-2 md:flex-row">
            <Button
              type="button"
              variant="outline"
              className="w-full md:w-auto"
              onClick={() => {
                openDialog(guideFor, true);
                setGuideFor(undefined);
              }}
            >
              <PencilIcon aria-hidden="true" />
              {t('printers.guide.editOffset')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full md:w-auto"
              onClick={() => setGuideFor(undefined)}
            >
              {t('printers.guide.close')}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={archiveTarget !== undefined}
        onOpenChange={(open) => !open && setArchiveTarget(undefined)}
        title={t('printers.archiveTitle')}
        description={t('printers.archiveConfirm', { name: archiveTarget?.name ?? '' })}
        confirmLabel={t('printers.archive')}
        cancelLabel={t('printers.form.cancel')}
        // Archiving keeps the print history: nothing is deleted.
        tone="default"
        busy={archive.isPending}
        onConfirm={confirmArchive}
      />

      <PrinterFormDialog
        open={dialog !== undefined}
        onOpenChange={(open) => {
          if (!open) setDialog(undefined);
        }}
        printer={dialog ?? undefined}
        openAdvanced={dialogAdvanced}
      />
    </SettingsSection>
  );
}
