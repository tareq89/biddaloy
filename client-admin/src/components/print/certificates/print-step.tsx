/**
 * [48.3.B-01] Steps 3 and 4 of the issue-certificate wizard: draw the certificate, then print
 * it through the certificate channel (`/certificates`, which gives it its serial) and ask
 * "did all print?" per batch. The batching loop is a clone of `print-preview.tsx`'s (not imported).
 */
import type { TemplateDefinition } from '@biddaloy/shared';
import { ApiError, getActiveTenant } from '@biddaloy/ui/api';
import {
  BUNDLED_PRINT_FONTS,
  Card,
  ErrorState,
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
  createCertificateJob,
  reprintCertificateJob,
  useCertificateAssets,
  useCertificatePrinters,
  useConfirmCertificateJob,
  type CreatePrintJobResult,
  type PreviewPrintJobResult,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

import { DidAllPrintDialog, type DidAllPrintItem } from '../preview/did-all-print-dialog';
import { defaultRunPrintDeps, runPrint, type PrintRequest } from '../preview/run-print';
import { useDataUrls } from '../preview/use-data-urls';
import { useRememberedPrinter } from '../preview/use-remembered-printer';

export interface IneligibleStudent {
  id: string;
  reason: string;
}

/** The 409 the server sends when some of the people cannot get this kind (`details.students`). */
export function ineligibleFrom(error: Error): IneligibleStudent[] | undefined {
  if (!(error instanceof ApiError) || error.statusCode !== 409) return undefined;
  const d = error.details as { code?: string; students?: IneligibleStudent[] } | undefined;
  return d?.code === 'CERTIFICATE_NOT_ELIGIBLE' && Array.isArray(d.students)
    ? d.students
    : undefined;
}

const chunk = <T,>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

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

const text = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : value == null
        ? ''
        : JSON.stringify(value);

interface PendingJob {
  jobId: string;
  items: DidAllPrintItem[];
  isReprint: boolean;
}

export interface UsePrintRunArgs {
  templateId: string | undefined;
  subjectIds: string[];
  issueValues: Record<string, string>;
  batchSize: number;
  /** Some people were refused (409): the wizard drops them and goes back. */
  onIneligible: (students: IneligibleStudent[]) => void;
  title: string;
}

export function usePrintRun({
  templateId,
  subjectIds,
  issueValues,
  batchSize,
  onIneligible,
  title,
}: UsePrintRunArgs) {
  const { t } = useTranslation('printPreview');
  const { i18n } = useTranslation('certificates');
  const tenantId = getActiveTenant() ?? '';
  const printersQuery = useCertificatePrinters();
  const assets = useCertificateAssets();
  const confirmJob = useConfirmCertificateJob();
  const [rememberedId, remember] = useRememberedPrinter(tenantId);
  const printers = (printersQuery.data ?? []).filter((p) => p.archived_at === null);
  const [pickedId, setPickedId] = React.useState<string | undefined>(undefined);
  const printer =
    printers.find((p) => p.id === pickedId) ??
    printers.find((p) => p.id === rememberedId) ??
    (printers.length === 1 ? printers[0] : undefined);

  // Ids whose batch is finished are never sent again, even if a later batch 409s and the list shrinks.
  const [issued, setIssued] = React.useState<ReadonlySet<string>>(new Set());
  const batches = React.useMemo(
    () =>
      chunk(
        subjectIds.filter((id) => !issued.has(id)),
        Math.max(1, batchSize),
      ),
    [subjectIds, batchSize, issued],
  );
  const [confirmed, setConfirmed] = React.useState(0);
  const [pending, setPending] = React.useState<PendingJob | null>(null);
  const [printing, setPrinting] = React.useState(false);
  // Every card the server made (item -> serial), and the items the person marked as not printed.
  const [made, setMade] = React.useState<Array<{ itemId: string; serial: string }>>([]);
  const [failed, setFailed] = React.useState<ReadonlySet<string>>(new Set());
  const running = React.useRef(false);
  // Not while a reprint of failed items is running or its answer is pending.
  const done = confirmed > 0 && batches.length === 0 && pending === null && !printing;

  // Inject the certificate functions; keep the serials the server gave (first/last on the result view).
  const deps = React.useMemo(() => {
    const keep = (job: CreatePrintJobResult) => {
      setMade((m) => [
        ...m,
        ...job.items.flatMap((i) =>
          i.serial_no ? [{ itemId: i.item_id, serial: i.serial_no }] : [],
        ),
      ]);
      return job;
    };
    return {
      ...defaultRunPrintDeps,
      createPrintJob: async (input: Parameters<typeof createCertificateJob>[0]) =>
        keep(await createCertificateJob(input)),
      // A reprint is the same serial, new copy: it counts once that copy prints.
      reprintPrintJob: async (jobId: string, itemIds: string[]) =>
        keep(await reprintCertificateJob(jobId, itemIds)),
    };
  }, []);
  // Serials with at least one copy that printed, in issue order (a FAILED-only serial is left out).
  const serials = [...new Set(made.filter((m) => !failed.has(m.itemId)).map((m) => m.serial))];

  async function startRun(request: PrintRequest, isReprint: boolean) {
    if (!printer || running.current) return;
    running.current = true;
    setPrinting(true);
    remember(printer.id);
    const result = await runPrint(
      {
        request,
        printer,
        assets: assets.data ?? [],
        assetPath: '/certificates/assets',
        subjectType: 'STUDENT',
        tenantId,
        lang: i18n.language,
        title,
        onError: (error) => {
          const refused = ineligibleFrom(error);
          if (refused) onIneligible(refused);
          else
            toast.error(error.message === 'POPUP_BLOCKED' ? t('popupBlocked') : t('printFailed'));
        },
      },
      deps,
    );
    running.current = false;
    setPrinting(false);
    if (result) {
      setPending({
        jobId: result.jobId,
        items: result.items.map((i) => ({ id: i.itemId, label: i.label })),
        isReprint,
      });
    }
  }

  const batchIds = batches[0] ?? [];
  const canPrint =
    Boolean(templateId && printer) && batchIds.length > 0 && !printing && pending === null;
  const print = () => {
    if (!canPrint || !templateId || !printer) return;
    void startRun(
      {
        kind: 'create',
        body: {
          template_id: templateId,
          subject_type: 'STUDENT',
          subject_ids: batchIds,
          printer_profile_id: printer.id,
          batch_label: `${confirmed + 1}/${confirmed + batches.length}`,
          issue_values: issueValues,
        },
      },
      false,
    );
  };

  const dialog = pending ? (
    <DidAllPrintDialog
      key={pending.jobId}
      open
      items={pending.items}
      onConfirm={async (failedItemIds) => {
        await confirmJob.mutateAsync({ jobId: pending.jobId, failedItemIds });
        setFailed((prev) => new Set([...prev, ...failedItemIds]));
      }}
      onReprintFailed={(failedItemIds) => {
        // The batch stays uncounted until a job for it is answered and the person moves on.
        const jobId = pending.jobId;
        setPending(null);
        void startRun({ kind: 'reprint', jobId, itemIds: failedItemIds }, true);
      }}
      onContinue={() => {
        // Continue = this batch is finished (all printed, or the person chose to leave the failed ones).
        setIssued((prev) => new Set([...prev, ...batchIds]));
        setConfirmed((n) => n + 1);
        setPending(null);
      }}
    />
  ) : null;

  return {
    printers,
    printersLoading: printersQuery.isPending,
    printer,
    pickPrinter: (id: string) => {
      setPickedId(id);
      remember(id);
    },
    batches,
    confirmed,
    pending: pending !== null,
    printing,
    canPrint,
    print,
    done,
    serials,
    dialog,
  };
}

export type PrintRun = ReturnType<typeof usePrintRun>;

/** Step 3: the certificate as it will print, from the preview call with the typed values. */
export function PreviewStep({
  preview,
  loading,
  error,
  onRetry,
}: {
  preview: PreviewPrintJobResult | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation('printPreview');
  const tenantId = getActiveTenant() ?? '';
  const definition: TemplateDefinition | undefined = preview?.template.version.definition;
  const item = preview?.items[0];
  const assetIds = definition
    ? [...collectValues(definition, 'assetId'), ...collectValues(definition, 'fontAssetId')]
    : [];
  const wantsLogo = Boolean(item?.values['school.logo']);
  const logoUrl = `/schools/${tenantId}/logo`;
  const urls = useDataUrls([
    ...assetIds.map((id) => `/certificates/assets/${id}/file`),
    ...(item?.photo_url ? [item.photo_url] : []),
    ...(wantsLogo ? [logoUrl] : []),
  ]);

  if (error) return <ErrorState message={t('previewError')} onRetry={onRetry} />;
  if (loading || !definition || !item) {
    return <Skeleton role="status" aria-label={t('loading')} className="h-56 w-full" />;
  }
  const values = {
    ...(Object.fromEntries(Object.entries(item.values).map(([k, v]) => [k, text(v)])) as Record<
      string,
      string
    >),
    'student.photo': item.photo_url ? (urls[item.photo_url] ?? '') : '',
    'school.logo': wantsLogo ? (urls[logoUrl] ?? '') : '',
  };
  return (
    <section aria-label={t('previewLabel')} className="flex flex-wrap gap-4 overflow-x-auto">
      {definition.page.sides.map((side) => (
        <figure key={side} className="flex flex-col gap-1" aria-label={t(`sides.${side}`)}>
          <TemplateRenderer
            definition={definition}
            side={side}
            values={values}
            assetUrl={(id) => urls[`/certificates/assets/${id}/file`] ?? ''}
            fonts={BUNDLED_PRINT_FONTS}
            mode="preview"
          />
          <figcaption className="text-caption text-text-secondary">{t(`sides.${side}`)}</figcaption>
        </figure>
      ))}
    </section>
  );
}

/** Step 4: pick the printer, press Print in the footer; after the last batch, the result view. */
export function PrintStep({
  run,
  canManageSettings,
}: {
  run: PrintRun;
  canManageSettings: boolean;
}) {
  const { t } = useTranslation('certificates');
  const { t: tp } = useTranslation('printPreview');
  const region = useRegionConfig();

  if (run.done) {
    const first = run.serials[0];
    const last = run.serials[run.serials.length - 1];
    return (
      <Card padded role="status">
        <h2 className="text-h2">
          {t('done.title', {
            count: run.serials.length,
            n: formatNumber(run.serials.length, region),
            ns: 'certificates',
          })}
        </h2>
        {first && last ? (
          <p className="mt-2 text-text-secondary">
            {t('done.serials', { first, last, ns: 'certificates' })}
          </p>
        ) : null}
      </Card>
    );
  }
  if (run.printersLoading) {
    return <Skeleton role="status" aria-label={tp('loading')} className="h-24 w-full" />;
  }
  return (
    <div className="flex flex-col gap-4">
      <Card padded>
        {run.printers.length === 0 ? (
          <div role="status" className="flex flex-col gap-2">
            <p>{t('printer.none', { ns: 'certificates' })}</p>
            {canManageSettings ? (
              <Link
                to="/settings"
                search={{ section: 'printing' } as never}
                className="text-primary underline"
              >
                {t('printer.settings', { ns: 'certificates' })}
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="flex max-w-sm flex-col gap-1.5">
            <span className="text-label">{t('printer.label', { ns: 'certificates' })}</span>
            <Select
              value={run.printer?.id ?? ''}
              onValueChange={run.pickPrinter}
              disabled={run.pending}
            >
              <SelectTrigger
                aria-label={t('printer.label', { ns: 'certificates' })}
                className="w-full"
              >
                <SelectValue placeholder={tp('controls.choosePrinter')} />
              </SelectTrigger>
              <SelectContent>
                {run.printers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {tp(`printerType.${p.printer_type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {run.confirmed + run.batches.length > 1 ? (
          <p className="mt-3 text-text-secondary">
            {tp('header.batch', {
              current: formatNumber(run.confirmed + 1, region),
              total: formatNumber(run.confirmed + run.batches.length, region),
              count: formatNumber(run.batches[0]?.length ?? 0, region),
            })}
          </p>
        ) : null}
      </Card>
      {run.dialog}
    </div>
  );
}
