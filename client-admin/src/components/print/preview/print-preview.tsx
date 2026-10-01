/**
 * [32.3.4] Print preview for one or many people (D9, D10, D14, D19, D21, D25,
 * D28, D46, D50, D53). It walks a run in batches: each batch is logged, printed
 * in a new tab, and then confirmed ("did all print?") before the next one unlocks.
 *
 * The route (32.4.1) supplies the three callbacks, so this component never
 * hard-codes a route (D60).
 */
import type { DocumentKind, TemplateDefinition } from '@biddaloy/shared';
import { getActiveTenant } from '@biddaloy/ui/api';
import {
  BUNDLED_PRINT_FONTS,
  Button,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  TemplateRenderer,
  toast,
} from '@biddaloy/ui/components';
import {
  useConfirmPrintJob,
  usePrinters,
  usePrintAssets,
  usePrintPreview,
  usePrintTemplates,
  type PrintSubjectType,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { BatchBar } from './batch-bar';
import { DidAllPrintDialog, type DidAllPrintItem } from './did-all-print-dialog';
import { PreflightPanel, type PreflightIssue } from './preflight-panel';
import { runPrint, type PrintRequest } from './run-print';
import { useDataUrls } from './use-data-urls';
import { useRememberedPrinter } from './use-remembered-printer';

export interface PrintPreviewProps {
  documentKind: DocumentKind;
  subjectType: PrintSubjectType;
  subjectIds: string[];
  /** "No template yet" call to action — create one from a suggestion. */
  onCreateTemplate: () => void;
  /** "No printer yet" call to action. */
  onAddPrinter: () => void;
  /** Every batch is confirmed. */
  onDone: () => void;
}

interface PendingJob {
  jobId: string;
  items: DidAllPrintItem[];
  isReprint: boolean;
}

const chunk = <T,>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

/** Every string under `key` in the (JSON) definition. */
function collectValues(value: unknown, key: string, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectValues(v, key, into));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === key && typeof v === 'string') into.add(v);
      else collectValues(v, key, into);
    }
  }
  return into;
}

/** A value as display text; objects/arrays never render as "[object Object]". */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return value == null ? '' : JSON.stringify(value);
}

/** A readable name for an element in a pre-flight message: its field, else its text, else its id. */
function elementName(definition: TemplateDefinition, elementId: string): string {
  const all = [...definition.front.elements, ...(definition.back?.elements ?? [])] as Array<
    Record<string, unknown>
  >;
  const el = all.find((e) => e.id === elementId);
  return text(el?.field ?? el?.text ?? elementId);
}

export function PrintPreview({
  documentKind,
  subjectType,
  subjectIds,
  onCreateTemplate,
  onAddPrinter,
  onDone,
}: PrintPreviewProps) {
  const { t, i18n } = useTranslation('printPreview');
  const tenantId = getActiveTenant() ?? '';
  const prefix = subjectType === 'STUDENT' ? 'student' : 'staff';

  const templatesQuery = usePrintTemplates(documentKind);
  const printersQuery = usePrinters();
  const fontAssets = usePrintAssets('FONT');
  const [rememberedId, remember] = useRememberedPrinter(tenantId);
  const preview = usePrintPreview();
  const confirmJob = useConfirmPrintJob();

  // --- template (D28): the default of the kind, switchable ------------------
  const published = (templatesQuery.data ?? []).filter(
    (x) => x.archived_at === null && x.current_version_id !== null,
  );
  const [pickedTemplateId, setPickedTemplateId] = React.useState<string | undefined>(undefined);
  const template =
    published.find((x) => x.id === pickedTemplateId) ??
    published.find((x) => x.is_default) ??
    published[0];

  // --- printer (D21): remembered per device ---------------------------------
  const printers = (printersQuery.data ?? []).filter((p) => p.archived_at === null);
  const [pickedPrinterId, setPickedPrinterId] = React.useState<string | undefined>(undefined);
  const printer =
    printers.find((p) => p.id === pickedPrinterId) ??
    printers.find((p) => p.id === rememberedId) ??
    (printers.length === 1 ? printers[0] : undefined);

  // --- batches (D10, D19, D46) ----------------------------------------------
  const maxBatch = template?.batch_size ?? 1;
  const [batchSizeInput, setBatchSizeInput] = React.useState<number | undefined>(undefined);
  // A cleared number input arrives as NaN, which `??` would let through: fall back to the max.
  const batchSize = Math.min(
    maxBatch,
    Math.max(1, Number.isFinite(batchSizeInput) ? (batchSizeInput as number) : maxBatch),
  );
  const batches = React.useMemo(() => chunk(subjectIds, batchSize), [subjectIds, batchSize]);
  const [confirmed, setConfirmed] = React.useState(0); // batches confirmed so far = index of the current one
  const batchIds = batches[confirmed] ?? [];
  const batchKey = batchIds.join(',');
  const [pending, setPending] = React.useState<PendingJob | null>(null);
  const [printing, setPrinting] = React.useState(false);
  const started = confirmed > 0 || pending !== null;

  // --- the preview -----------------------------------------------------------
  const { mutate: loadPreview } = preview;
  const templateId = template?.id;
  React.useEffect(() => {
    if (!templateId || batchKey === '') return;
    loadPreview({
      template_id: templateId,
      subject_type: subjectType,
      subject_ids: batchKey.split(','),
    });
  }, [templateId, batchKey, subjectType, loadPreview]);

  const data = preview.data;
  const definition = data?.template.version.definition;
  const items = data?.items ?? [];

  const assetUrls = definition
    ? [...collectValues(definition, 'assetId'), ...collectValues(definition, 'fontAssetId')].map(
        (id) => `/print-assets/${id}/file`,
      )
    : [];
  const wantsLogo = items.some((i) => Boolean(i.values['school.logo']));
  const logoUrl = `/schools/${tenantId}/logo`;
  const dataUrls = useDataUrls([
    ...assetUrls,
    ...items.flatMap((i) => (i.photo_url ? [i.photo_url] : [])),
    ...(wantsLogo ? [logoUrl] : []),
  ]);
  const assetUrl = (id: string) => dataUrls[`/print-assets/${id}/file`] ?? '';

  // --- pre-flight (D14) ------------------------------------------------------
  const [overflowState, setOverflowState] = React.useState<{
    key: string;
    map: Record<string, string[]>;
  }>({
    key: '',
    map: {},
  });
  const overflow = overflowState.key === batchKey ? overflowState.map : {};
  const reportOverflow = (subjectId: string) => (elementId: string, over: boolean) =>
    setOverflowState((prev) => {
      const map = prev.key === batchKey ? prev.map : {};
      const current = map[subjectId] ?? [];
      if (over === current.includes(elementId))
        return prev.key === batchKey ? prev : { key: batchKey, map };
      return {
        key: batchKey,
        map: {
          ...map,
          [subjectId]: over ? [...current, elementId] : current.filter((x) => x !== elementId),
        },
      };
    });

  const usesPhoto = definition ? JSON.stringify(definition).includes(`${prefix}.photo`) : false;
  const issues: PreflightIssue[] = definition
    ? items.flatMap((item) => {
        const reasons: string[] = [];
        const fields = (overflow[item.subject_id] ?? []).map((id) => elementName(definition, id));
        if (fields.length > 0) reasons.push(t('preflight.overflow', { fields: fields.join(', ') }));
        if (usesPhoto && !item.photo_url) reasons.push(t('preflight.noPhoto'));
        const nameKey = `${prefix}.name`;
        if (!text(item.values[nameKey]).trim()) {
          reasons.push(t('preflight.empty', { fields: nameKey }));
        }
        return reasons.length > 0
          ? [{ subjectId: item.subject_id, label: item.label, reasons }]
          : [];
      })
    : [];
  const [printAnyway, setPrintAnyway] = React.useState(false);
  const anywayFor = React.useRef('');
  if (anywayFor.current !== batchKey) {
    // A new batch starts unticked: consent to one batch's problems isn't consent to the next's.
    anywayFor.current = batchKey;
    if (printAnyway) setPrintAnyway(false);
  }

  // --- printing (D9, D53) ----------------------------------------------------
  async function startRun(request: PrintRequest, isReprint: boolean) {
    if (!printer) return;
    setPrinting(true);
    remember(printer.id);
    const result = await runPrint({
      request,
      printer,
      assets: fontAssets.data ?? [],
      subjectType,
      tenantId,
      lang: i18n.language,
      title: t('title'),
      onError: (error) =>
        toast.error(error.message === 'POPUP_BLOCKED' ? t('popupBlocked') : t('printFailed')),
    });
    setPrinting(false);
    if (result) {
      setPending({
        jobId: result.jobId,
        items: result.items.map((i) => ({ id: i.itemId, label: i.label })),
        isReprint,
      });
    }
  }

  const canPrint =
    Boolean(template && printer && data) &&
    batchIds.length > 0 &&
    !printing &&
    pending === null &&
    (issues.length === 0 || printAnyway);

  const print = () => {
    if (!canPrint || !template) return;
    void startRun(
      {
        kind: 'create',
        body: {
          template_id: template.id,
          subject_type: subjectType,
          subject_ids: batchIds,
          ...(printer ? { printer_profile_id: printer.id } : {}),
          batch_label: `${confirmed + 1}/${batches.length}`,
        },
      },
      false,
    );
  };

  // Enter prints when focus is on the page itself (not inside a control).
  const printRef = React.useRef(print);
  printRef.current = print;
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target && target !== document.body && !target.closest('[data-print-preview]')) return;
      if (
        target &&
        target.closest('button, a, input, select, textarea, [role="combobox"], [role="dialog"]')
      )
        return;
      printRef.current();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // --- empty states ----------------------------------------------------------
  if (templatesQuery.isPending || printersQuery.isPending) {
    return <Skeleton role="status" aria-label={t('loading')} className="h-40 w-full" />;
  }
  if (!template) {
    return (
      <EmptyState
        title={t('noTemplate.title')}
        explanation={t('noTemplate.explanation')}
        action={{ label: t('noTemplate.action'), onClick: onCreateTemplate }}
      />
    );
  }

  const printerTypeLabel = printer ? t(`printerType.${printer.printer_type}`) : '';

  return (
    <div data-print-preview className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('header.batch', {
            current: Math.min(confirmed + 1, batches.length),
            total: batches.length,
            count: batchIds.length,
          })}
          {printer
            ? ` · ${t('header.printer', { name: printer.name, type: printerTypeLabel })}`
            : ''}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {published.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('controls.template')}</span>
            <Select value={template.id} onValueChange={setPickedTemplateId} disabled={started}>
              <SelectTrigger aria-label={t('controls.template')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {published.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {printers.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('controls.printer')}</span>
            <Select
              value={printer?.id ?? ''}
              onValueChange={(id) => {
                setPickedPrinterId(id);
                remember(id);
              }}
            >
              <SelectTrigger aria-label={t('controls.printer')}>
                <SelectValue placeholder={t('controls.choosePrinter')} />
              </SelectTrigger>
              <SelectContent>
                {printers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {t(`printerType.${p.printer_type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="print-batch-size" className="text-sm font-medium">
            {t('controls.batchSize', { max: maxBatch })}
          </label>
          <Input
            id="print-batch-size"
            type="number"
            min={1}
            max={maxBatch}
            value={batchSize}
            disabled={started}
            onChange={(e) => setBatchSizeInput(e.target.valueAsNumber)}
          />
        </div>
      </div>

      {printers.length === 0 ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border-subtle p-3 text-sm"
        >
          <span>{t('noPrinter.notice')}</span>
          <Button type="button" size="sm" variant="outline" onClick={onAddPrinter}>
            {t('noPrinter.action')}
          </Button>
        </div>
      ) : null}

      <BatchBar batchSizes={batches.map((b) => b.length)} current={confirmed} />
      <PreflightPanel
        issues={issues}
        total={items.length}
        acknowledged={printAnyway}
        onAcknowledgedChange={setPrintAnyway}
      />

      {preview.isPending && !data ? (
        <Skeleton role="status" aria-label={t('loading')} className="h-56 w-full" />
      ) : preview.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('previewError')}
        </p>
      ) : definition ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const values = {
              ...(Object.fromEntries(
                Object.entries(item.values).map(([k, v]) => [k, text(v)]),
              ) as Record<string, string>),
              [`${prefix}.photo`]: item.photo_url ? (dataUrls[item.photo_url] ?? '') : '',
              'school.logo': wantsLogo ? (dataUrls[logoUrl] ?? '') : '',
            };
            return (
              <li key={item.subject_id} className="flex flex-col gap-2">
                <p className="text-sm font-medium">{item.label}</p>
                <div className="flex flex-wrap gap-2 overflow-x-auto">
                  {definition.page.sides.map((side) => (
                    <figure
                      key={side}
                      className="flex flex-col gap-1"
                      aria-label={`${item.label} · ${t(`sides.${side}`)}`}
                    >
                      <TemplateRenderer
                        definition={definition}
                        side={side}
                        values={values}
                        assetUrl={assetUrl}
                        fonts={BUNDLED_PRINT_FONTS}
                        mode="preview"
                        {...(side === 'front'
                          ? { onOverflow: reportOverflow(item.subject_id) }
                          : {})}
                      />
                      <figcaption className="text-xs text-muted-foreground">
                        {t(`sides.${side}`)}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="button" disabled={!canPrint} loading={printing} onClick={print}>
          {printing ? t('printing') : t('print')}
        </Button>
        {pending ? <span className="text-sm text-muted-foreground">{t('locked')}</span> : null}
      </div>

      {pending ? (
        <DidAllPrintDialog
          key={pending.jobId}
          open
          items={pending.items}
          onConfirm={async (failedItemIds) => {
            await confirmJob.mutateAsync({ jobId: pending.jobId, failedItemIds });
            // Only the batch's own job unlocks the next batch; a reprint of failures doesn't.
            if (!pending.isReprint) setConfirmed((n) => n + 1);
          }}
          onReprintFailed={(failedItemIds) => {
            const jobId = pending.jobId;
            setPending(null);
            void startRun({ kind: 'reprint', jobId, itemIds: failedItemIds }, true);
          }}
          onContinue={() => {
            setPending(null);
            if (confirmed >= batches.length) onDone();
          }}
        />
      ) : null}
    </div>
  );
}
