/**
 * [32.2.10] Print module client hooks — templates, assets, printers, jobs,
 * history. Follows `seat-plans.ts`: a key factory per entity, `queryOptions`
 * for reads, and every mutation invalidates the keys it changes.
 *
 * Request bodies come from `schema.d.ts`. The responses are hand-typed here
 * because the print controllers have no `@ApiResponse` decoration (the same
 * gap `seat-plans.ts` documents), so `schema.d.ts` only types the inputs.
 *
 * Two things are plain async functions, not hooks, on purpose:
 * `createPrintJob` and `fetchPrintAssetDataUrl`. `openPrintWindow`
 * (`components/print/print-document`) calls them inside its `prepare` step,
 * after it has already opened the blank tab (D53) — a hook can't be called there.
 */
import type { DocumentKind, TemplateDefinition } from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/* ------------------------------------------------------------------ types */

export type CreatePrintTemplateInput = components['schemas']['CreatePrintTemplateDto'];
export type UpdatePrintTemplateInput = components['schemas']['UpdatePrintTemplateDto'];
export type CreatePrinterInput = components['schemas']['CreatePrinterProfileDto'];
export type UpdatePrinterInput = components['schemas']['UpdatePrinterProfileDto'];
export type CreatePrintJobInput = components['schemas']['CreatePrintJobDto'];
export type PreviewPrintJobInput = components['schemas']['PreviewPrintJobDto'];

export type PrintSubjectType = 'STUDENT' | 'STAFF';

export interface PrintTemplateRow {
  id: string;
  name: string;
  document_kind: DocumentKind;
  layout_kind: string;
  is_default: boolean;
  batch_size: number;
  current_version_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  /** Present on the detail response; the editor's working copy. */
  draft?: TemplateDefinition;
}

export interface PrintTemplateVersionRow {
  id: string;
  template_id: string;
  version: number;
  definition: TemplateDefinition;
  published_at: string;
}

export interface PrintSuggestion {
  key: string;
  documentKind: DocumentKind;
  orientation: 'portrait' | 'landscape';
  style: 'classic' | 'modern';
  nameKey: string;
}

export type PrintAssetKind = 'ARTWORK' | 'IMAGE' | 'FONT';

export interface PrintAssetRow {
  id: string;
  asset_kind: PrintAssetKind;
  content_type: string;
  byte_size: number;
  width_px: number | null;
  height_px: number | null;
  font_family: string | null;
  original_name: string;
  archived_at: string | null;
  created_at: string;
}

export interface PrinterRow {
  id: string;
  name: string;
  printer_type: 'CARD' | 'OFFICE';
  margin_top_mm: number;
  margin_right_mm: number;
  margin_bottom_mm: number;
  margin_left_mm: number;
  offset_x_mm: number;
  offset_y_mm: number;
  scale: number;
  duplex_order: 'INTERLEAVED' | 'GROUPED';
  sheet_gap_mm: number;
  archived_at: string | null;
}

/** One card, as the server built it. The client never supplies these values (invariant). */
export interface PrintJobItemResult {
  item_id: string;
  subject_id: string;
  label: string;
  values: Record<string, unknown>;
  copy_number: number;
  verify_url: string;
  photo_url: string | null;
}

export interface CreatePrintJobResult {
  job_id: string;
  items: PrintJobItemResult[];
  version: { id: string; definition: TemplateDefinition };
}

export interface PreviewPrintJobResult {
  template: {
    id: string;
    batch_size: number;
    version: { id: string; version: number; definition: TemplateDefinition };
  };
  items: Array<{
    subject_id: string;
    label: string;
    values: Record<string, unknown>;
    photo_url: string | null;
  }>;
}

export interface PrintHistoryRow {
  item_id: string;
  job_id: string;
  created_at: string;
  printed_by_name: string | null;
  template_name: string;
  template_version: number;
  document_kind: DocumentKind;
  subject_type: PrintSubjectType;
  subject_id: string | null;
  subject_label: string;
  copy_number: number;
  outcome: 'PENDING' | 'OK' | 'FAILED';
  revoked_at: string | null;
  job_status: 'OPEN' | 'CONFIRMED';
}

/** The single item adds the frozen snapshot + the version definition, so the UI can re-render it. */
export interface PrintHistoryItemDetail extends PrintHistoryRow {
  data_snapshot: {
    values: Record<string, unknown>;
    photoKey: string | null;
    copyNumber: number;
    issuedAt: string;
  };
  revoke_reason: string | null;
  template_definition: TemplateDefinition;
}

export interface PrintHistoryFilters {
  document_kind?: DocumentKind;
  template_id?: string;
  subject_type?: PrintSubjectType;
  subject_id?: string;
  printed_by?: string;
  from?: string;
  to?: string;
  status?: 'OPEN' | 'CONFIRMED';
  outcome?: 'PENDING' | 'OK' | 'FAILED';
  revoked?: boolean;
  q?: string;
  page?: number;
  limit?: number;
}

export interface PrintHistoryPage {
  data: PrintHistoryRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ------------------------------------------------------------------- keys */

export const printTemplateKeys = createEntityKeys<{ kind?: DocumentKind }>('print-templates');
export const printAssetKeys = createEntityKeys<{ kind?: PrintAssetKind }>('print-assets');
export const printerKeys = createEntityKeys<Record<string, never>>('printers');
export const printHistoryKeys = createEntityKeys<PrintHistoryFilters>('print-history');
/** Per-subject history lives under the same root, so one invalidation refreshes both. */
const subjectHistoryKey = (type: PrintSubjectType, id: string) =>
  [...printHistoryKeys.all, 'subject', type, id] as const;
const suggestionsKey = () => [...printTemplateKeys.all, 'suggestions'] as const;
const versionsKey = (id: string) => [...printTemplateKeys.all, 'versions', id] as const;

/* -------------------------------------------------------------- templates */

export function printTemplatesQueryOptions(kind?: DocumentKind) {
  return queryOptions({
    queryKey: printTemplateKeys.list(kind ? { kind } : {}),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<PrintTemplateRow[]>('/print-templates', {
          params: kind ? { document_kind: kind } : {},
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

export function usePrintTemplates(kind?: DocumentKind) {
  return useQuery(printTemplatesQueryOptions(kind));
}

export function usePrintTemplate(id: string) {
  return useQuery({
    queryKey: printTemplateKeys.detail(id),
    queryFn: async ({ signal }) =>
      (await apiClient.get<PrintTemplateRow>(`/print-templates/${id}`, { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function usePrintSuggestions() {
  return useQuery({
    queryKey: suggestionsKey(),
    queryFn: async ({ signal }) =>
      (await apiClient.get<PrintSuggestion[]>('/print-templates/suggestions', { signal })).data,
    retry: shouldRetryQuery,
    // The seeded suggestions only change with a deploy.
    staleTime: Infinity,
  });
}

export function usePrintTemplateVersions(id: string) {
  return useQuery({
    queryKey: versionsKey(id),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<PrintTemplateVersionRow[]>(`/print-templates/${id}/versions`, {
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

export function useCreatePrintTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePrintTemplateInput) =>
      (await apiClient.post<PrintTemplateRow>('/print-templates', input)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: printTemplateKeys.lists() }),
  });
}

export function useUpdatePrintTemplate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePrintTemplateInput) =>
      (await apiClient.patch<PrintTemplateRow>(`/print-templates/${id}`, input)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(printTemplateKeys.detail(id), data);
      void queryClient.invalidateQueries({ queryKey: printTemplateKeys.lists() });
    },
  });
}

/** Publish freezes the draft as the next immutable version (D17, D36). */
export function usePublishPrintTemplate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<PrintTemplateVersionRow>(`/print-templates/${id}/publish`, {})).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: printTemplateKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: printTemplateKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: versionsKey(id) });
    },
  });
}

export function useSetDefaultPrintTemplate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<PrintTemplateRow>(`/print-templates/${id}/default`, {})).data,
    // Making one default un-defaults its siblings, so the whole list is stale.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: printTemplateKeys.all }),
  });
}

export function useArchivePrintTemplate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<PrintTemplateRow>(`/print-templates/${id}/archive`, {})).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: printTemplateKeys.all }),
  });
}

/* ----------------------------------------------------------------- assets */

export function usePrintAssets(kind?: PrintAssetKind) {
  return useQuery({
    queryKey: printAssetKeys.list(kind ? { kind } : {}),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<PrintAssetRow[]>('/print-assets', {
          params: kind ? { kind } : {},
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

/** Multipart upload with progress, the same shape as `backup.ts`'s validate call. */
export function useUploadPrintAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      kind,
      file,
      fontFamily,
      onProgress,
    }: {
      kind: PrintAssetKind;
      file: File;
      fontFamily?: string;
      onProgress?: (percent: number) => void;
    }) => {
      const formData = new FormData();
      formData.append('kind', kind);
      if (fontFamily) formData.append('font_family', fontFamily);
      formData.append('file', file);
      const res = await apiClient.post<PrintAssetRow>('/print-assets', formData, {
        onUploadProgress: (event) => {
          if (onProgress && event.total) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        },
      });
      return res.data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: printAssetKeys.lists() }),
  });
}

export function useArchivePrintAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await apiClient.post<PrintAssetRow>(`/print-assets/${id}/archive`, {})).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: printAssetKeys.lists() }),
  });
}

/**
 * The print document must be self-contained (it is written into a blank tab that
 * has no login), so artwork and images are inlined as data URLs. The file route
 * needs the bearer token, hence `apiClient` and not a bare `<img src>`.
 */
export async function fetchPrintAssetDataUrl(id: string): Promise<string> {
  const res = await apiClient.get<Blob>(`/print-assets/${id}/file`, { responseType: 'blob' });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read the asset'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the asset'));
    reader.readAsDataURL(res.data);
  });
}

/* --------------------------------------------------------------- printers */

export function usePrinters() {
  return useQuery({
    queryKey: printerKeys.list({}),
    queryFn: async ({ signal }) =>
      (await apiClient.get<PrinterRow[]>('/printers', { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useCreatePrinter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePrinterInput) =>
      (await apiClient.post<PrinterRow>('/printers', input)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: printerKeys.lists() }),
  });
}

export function useUpdatePrinter(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePrinterInput) =>
      (await apiClient.patch<PrinterRow>(`/printers/${id}`, input)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: printerKeys.lists() }),
  });
}

export function useArchivePrinter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await apiClient.post<PrinterRow>(`/printers/${id}/archive`, {})).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: printerKeys.lists() }),
  });
}

/* ------------------------------------------------------------------- jobs */

/** A mutation only because it is a POST — it creates nothing. */
export function usePrintPreview() {
  return useMutation({
    mutationFn: async (input: PreviewPrintJobInput) =>
      (await apiClient.post<PreviewPrintJobResult>('/print-jobs/preview', input)).data,
  });
}

/**
 * Commits the print job (copy numbers, verify tokens, snapshot) and returns what
 * to render. A plain function: `openPrintWindow` calls it inside `prepare`.
 * The row is committed BEFORE this resolves, so nothing prints unlogged.
 */
export async function createPrintJob(input: CreatePrintJobInput): Promise<CreatePrintJobResult> {
  return (await apiClient.post<CreatePrintJobResult>('/print-jobs', input)).data;
}

/** D25: "Did all N print correctly?" — the ticked items are the failures. */
export function useConfirmPrintJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId, failedItemIds }: { jobId: string; failedItemIds: string[] }) =>
      (
        await apiClient.patch<{ job_id: string; status: 'CONFIRMED'; failed_item_ids: string[] }>(
          `/print-jobs/${jobId}/confirm`,
          { failed_item_ids: failedItemIds },
        )
      ).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: printHistoryKeys.all }),
  });
}

/** D59: same version and data, new copy number and verify token. A function, like `createPrintJob`. */
export async function reprintPrintJob(
  jobId: string,
  itemIds: string[],
): Promise<CreatePrintJobResult> {
  return (
    await apiClient.post<CreatePrintJobResult>(`/print-jobs/${jobId}/reprint`, {
      item_ids: itemIds,
    })
  ).data;
}

/** Newest first, at most 100 — feeds the Documents tabs on a student / staff page. */
export function useSubjectPrintHistory(type: PrintSubjectType, id: string) {
  return useQuery({
    queryKey: subjectHistoryKey(type, id),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<PrintHistoryRow[]>('/print-jobs/subject-history', {
          params: { subject_type: type, subject_id: id },
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

/* ---------------------------------------------------------------- history */

export function usePrintHistory(filters: PrintHistoryFilters = {}) {
  return useQuery({
    queryKey: printHistoryKeys.list(filters),
    queryFn: async ({ signal }) =>
      (await apiClient.get<PrintHistoryPage>('/print-history', { params: filters, signal })).data,
    retry: shouldRetryQuery,
  });
}

export function usePrintHistoryItem(id: string) {
  return useQuery({
    queryKey: printHistoryKeys.detail(id),
    queryFn: async ({ signal }) =>
      (await apiClient.get<PrintHistoryItemDetail>(`/print-history/items/${id}`, { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useRevokePrintItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, reason }: { itemId: string; reason: string }) =>
      (
        await apiClient.post<{ item_id: string; revoked_at: string }>(
          `/print-history/items/${itemId}/revoke`,
          { reason },
        )
      ).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: printHistoryKeys.all }),
  });
}
