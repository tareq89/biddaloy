/**
 * [32.3.4] One print run: create the job, build the self-contained document,
 * open it in the print tab.
 *
 * ORDER IS THE POINT (D9): `prepare` creates (or reprints) the job FIRST. If that
 * fails, nothing is built and the blank tab that `openPrintWindow` already opened
 * is closed, so nothing can be printed without a row in the print history.
 *
 * The dependencies are injected so a test can prove the order without a browser.
 */
import { apiClient } from '@biddaloy/ui/api';
import {
  BUNDLED_PRINT_FONTS,
  buildPrintDocument,
  fetchAsDataUrl,
  layoutPages,
  openPrintWindow,
  type BlobFetcher,
  type PrintFont,
} from '@biddaloy/ui/components';
import {
  createPrintJob,
  reprintPrintJob,
  type CreatePrintJobInput,
  type CreatePrintJobResult,
  type PrintAssetRow,
  type PrinterRow,
  type PrintSubjectType,
} from '@biddaloy/ui/hooks';

export type PrintRequest =
  | { kind: 'create'; body: CreatePrintJobInput }
  | { kind: 'reprint'; jobId: string; itemIds: string[] };

export interface RunPrintArgs {
  request: PrintRequest;
  printer: PrinterRow;
  /** Font assets (for their family names); other kinds are ignored. */
  assets: PrintAssetRow[];
  subjectType: PrintSubjectType;
  tenantId: string;
  lang: string;
  title: string;
  onError: (error: Error) => void;
}

export interface RunPrintResult {
  jobId: string;
  items: Array<{ itemId: string; subjectId: string; label: string }>;
}

export interface RunPrintDeps {
  createPrintJob: typeof createPrintJob;
  reprintPrintJob: typeof reprintPrintJob;
  openPrintWindow: typeof openPrintWindow;
  buildPrintDocument: typeof buildPrintDocument;
  /** Authenticated API blobs (photos, logo, artwork). */
  fetchBlob: BlobFetcher;
  /** Same-origin static files (the bundled fonts). */
  fetchStatic: BlobFetcher;
  origin: string;
}

export const defaultRunPrintDeps: RunPrintDeps = {
  createPrintJob,
  reprintPrintJob,
  openPrintWindow,
  buildPrintDocument,
  fetchBlob: async (url) => (await apiClient.get<Blob>(url, { responseType: 'blob' })).data,
  fetchStatic: async (url) => (await fetch(url)).blob(),
  origin: typeof window === 'undefined' ? '' : window.location.origin,
};

/** Every string value stored under `key` anywhere in the (JSON) definition. */
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

export async function runPrint(
  args: RunPrintArgs,
  deps: RunPrintDeps = defaultRunPrintDeps,
): Promise<RunPrintResult | undefined> {
  const { request, printer, assets, subjectType, tenantId, lang, title, onError } = args;
  let result: RunPrintResult | undefined;
  let failed = false;

  await deps.openPrintWindow(
    async () => {
      // 1. The job first (D9). A failure here throws before anything below runs.
      const job: CreatePrintJobResult =
        request.kind === 'create'
          ? await deps.createPrintJob(request.body)
          : await deps.reprintPrintJob(request.jobId, request.itemIds);
      result = {
        jobId: job.job_id,
        items: job.items.map((i) => ({
          itemId: i.item_id,
          subjectId: i.subject_id,
          label: i.label,
        })),
      };

      // 2. Everything the tab needs as data URLs: it has no login and makes no requests.
      const definition = job.version.definition;
      const cache = new Map<string, Promise<string>>();
      const dataUrl = (url: string, fetcher: BlobFetcher = deps.fetchBlob) =>
        fetchAsDataUrl(url, fetcher, cache);

      const assetIds = [
        ...collectValues(definition, 'assetId'),
        ...collectValues(definition, 'fontAssetId'),
      ];
      const assetData = new Map(
        await Promise.all(
          assetIds.map(
            async (id) => [id, await dataUrl(`/print-assets/${id}/file`)] as [string, string],
          ),
        ),
      );

      const families = collectValues(definition, 'fontFamily');
      const bundled: PrintFont[] = await Promise.all(
        BUNDLED_PRINT_FONTS.filter((f) => families.has(f.family)).map(async (f) => ({
          ...f,
          url: await dataUrl(f.url, deps.fetchStatic),
        })),
      );
      const uploaded: PrintFont[] = assets
        .filter((a) => a.asset_kind === 'FONT' && assetData.has(a.id))
        .map((a) => ({ family: a.font_family ?? a.id, url: assetData.get(a.id) as string }));

      const logoUrl = `/schools/${tenantId}/logo`;
      const prefix = subjectType === 'STUDENT' ? 'student' : 'staff';
      const cards = await Promise.all(
        job.items.map(async (item) => {
          const wantsLogo = Boolean(item.values['school.logo']);
          return {
            ...(item.values as Record<string, string>),
            [`${prefix}.photo`]: item.photo_url ? await dataUrl(item.photo_url) : '',
            'school.logo': wantsLogo ? await dataUrl(logoUrl) : '',
            // 3. Absolute, because the tab is a blob: page with no origin of its own.
            'print.verify_qr': `${deps.origin}${item.verify_url}`,
            'print.copyNumber': String(item.copy_number),
          };
        }),
      );

      const sheets = layoutPages(
        definition.page,
        {
          type: printer.printer_type,
          marginMm: printer.margin_left_mm,
          gapMm: printer.sheet_gap_mm,
          duplex: printer.duplex_order,
        },
        job.items.length,
        definition.page.sides,
      );

      // 4. The document.
      return deps.buildPrintDocument({
        definition,
        sheets,
        cards,
        printer: {
          type: printer.printer_type,
          offsetXMm: printer.offset_x_mm,
          offsetYMm: printer.offset_y_mm,
          scale: printer.scale,
        },
        fonts: [...bundled, ...uploaded],
        lang,
        title,
        assetUrl: (id) => assetData.get(id) ?? '',
      });
    },
    (error) => {
      // The job may already exist (it is logged first, by design) but nothing was printed:
      // report failure so the caller doesn't ask "did all cards print?" about it.
      failed = true;
      onError(error);
    },
  );

  return failed ? undefined : result;
}
