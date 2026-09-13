import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import type { BulkImportError, PreviewResult } from './use-bulk-upload-preview';

/**
 * Hand-declared to mirror the *real* server DTOs, verified directly against
 * source rather than relayed:
 * - `server/src/modules/workbook/export/dto/workbook-job.dto.ts` (`WorkbookJobDto`)
 * - `server/src/modules/workbook/jobs/workbook-job.entity.ts` (the enums)
 * - `server/src/modules/workbook/import/dto/validate-response.dto.ts` (`ValidateResponseDto`)
 * - `server/src/modules/workbook/restore/dto/restore.dto.ts` (`RequestRestoreDto`/`RequestRestoreResponseDto`)
 *
 * These replace an earlier hand-typed guess (#611) that didn't match any of
 * the above — see the [14.11.5] commit that introduced this file for the
 * full list of mismatches. `schema.d.ts` still has no OpenAPI-generated
 * types for this route, so this stays hand-typed against server source,
 * same convention as `school-profile.ts`'s `SchoolProfile`.
 */
export type WorkbookJobKind = 'EXPORT' | 'SNAPSHOT' | 'RESTORE';
export type WorkbookJobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'DELETED';
export type WorkbookJobSource = 'MANUAL' | 'SCHEDULED' | 'SNAPSHOT';

export interface WorkbookJobRequester {
  id: string;
  full_name: string;
}

export interface WorkbookJobProgress {
  tab: string;
  done: number;
  total: number;
}

export interface WorkbookJob {
  id: string;
  kind: WorkbookJobKind;
  status: WorkbookJobStatus;
  source: WorkbookJobSource;
  requested_by: WorkbookJobRequester | null;
  /** bigint column — the server hands this back as a string. Never
   * `Number()` this for anything beyond display formatting. */
  size_bytes: string | null;
  row_counts: Record<string, number> | null;
  progress: WorkbookJobProgress | null;
  failed_tab: string | null;
  snapshot_job_id: string | null;
  error: string | null;
  pinned: boolean;
  expires_at: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface WorkbookJobListFilters {
  kind?: WorkbookJobKind;
  status?: WorkbookJobStatus;
  page?: number;
  limit?: number;
}

export interface PaginatedWorkbookJobs {
  data: WorkbookJob[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** [14.12.3/#617] Sum of `size_bytes` over every DONE, still-stored job
   * for the tenant — bigint, hence a string, same as `WorkbookJob.size_bytes`.
   * Mirrors `WorkbookJobListResponseDto.storage_total_bytes`. */
  storage_total_bytes: string;
}

/** One tab's dry-run diff — mirrors `TabSummaryDto`. There is no per-tab
 * error count in this DTO; row-level errors/warnings are top-level
 * `BulkImportErrorDto[]` on the validate response, not per tab. */
export interface TabSummaryDto {
  name: string;
  present: boolean;
  creates: number;
  updates: number;
  unchanged: number;
  deletes: number;
}

export interface ValidateTotalsDto {
  creates: number;
  updates: number;
  unchanged: number;
  deletes: number;
}

/** The `summary` half of `PreviewResult<RestoreSummary>` — everything the
 * flat `ValidateResponseDto` carries beyond the `staging_id`/`expires_at`/
 * `errors`/`hard_error_count` fields `PreviewResult` already models.
 * `meta.source_school_name` is read out of the *uploaded workbook* — it
 * must never be used as the restore confirmation gate's expected value
 * (the session's real school name comes from `useSchoolProfile()`
 * instead), so it's kept here purely for display. */
export interface RestoreSummary {
  meta: {
    schema_version: number;
    kind: string;
    exported_at: string;
    app_version: string;
    source_school_name: string;
    source_school_slug: string;
  };
  tabs: TabSummaryDto[];
  totals: ValidateTotalsDto;
  warnings: BulkImportError[];
  is_empty_tenant: boolean;
}

/** Server response shape of `POST /backup/validate` — flat, no `summary`
 * wrapper. `useValidateBackup` reshapes this into `PreviewResult<RestoreSummary>`
 * for `BulkUploadPreview`. */
interface ValidateResponseDto {
  staging_id: string;
  expires_at: string;
  meta: RestoreSummary['meta'];
  tabs: TabSummaryDto[];
  totals: ValidateTotalsDto;
  errors: BulkImportError[];
  warnings: BulkImportError[];
  hard_error_count: number;
  is_empty_tenant: boolean;
}

/** Body of `POST /backup/restore` — mirrors `RequestRestoreDto` exactly.
 * Field names are `staging_id`/`confirmation`/`invite_users`. */
export interface RestoreBackupInput {
  staging_id: string;
  confirmation: string;
  /** Restored users arrive without credentials; inviting them is opt-in,
   * default off. */
  invite_users?: boolean;
}

/** `POST /backup/restore` resolves as soon as the restore is *queued*
 * (`@HttpCode(202)`), not once it finishes — mirrors
 * `RequestRestoreResponseDto`. The caller polls `useBackupJob(job_id)` for
 * live progress. */
export interface RequestRestoreResponse {
  job_id: string;
  snapshot_job_id: string;
}

/**
 * The reference query-key instance for this entity — see
 * `./query-keys.ts`'s own comment and `./students.ts`'s `studentKeys` for
 * the pattern every entity's keys mirror.
 */
export const backupKeys = createEntityKeys<WorkbookJobListFilters>('backup-jobs');

/** `GET /backup/jobs` — the list of export/snapshot/restore jobs for the
 * active tenant, newest first (server-side ordering). */
export function useBackupJobs(filters: WorkbookJobListFilters = {}) {
  return useQuery({
    queryKey: backupKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedWorkbookJobs>('/backup/jobs', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
    // A job invalidated onto this page as QUEUED/RUNNING otherwise never
    // moves — nothing else refetches this list, so a row's status would be
    // stuck at whatever it was the moment it appeared.
    refetchInterval: (query) => {
      const jobs = query.state.data?.data ?? [];
      const hasPendingJob = jobs.some((job) => job.status === 'QUEUED' || job.status === 'RUNNING');
      return hasPendingJob ? 2000 : false;
    },
  });
}

/** `GET /backup/jobs/:id` — polls every 2s while the job is still
 * `QUEUED`/`RUNNING` so the caller sees live progress, and stops polling
 * once it lands on a terminal status (`DONE`/`FAILED`/`DELETED`). */
/** [14.13.3] `tenantId` is set only by the SUPER_ADMIN provision-from-workbook
 * flow (`RestoreWizard`'s own `tenantId` prop) to poll a school's job while
 * it isn't the caller's active tenant — see `apiClient`'s request
 * interceptor, which honors a request-config `_tenantOverride` over the
 * ambient active one. Every other caller omits it and gets the old ambient-tenant
 * behavior unchanged. The query key folds `tenantId` in so this never
 * collides with (or is invalidated by) the ambient-tenant job list. */
export function useBackupJob(id: string | undefined, options: { tenantId?: string } = {}) {
  const { tenantId } = options;
  return useQuery({
    queryKey: backupKeys.detail(tenantId ? `${tenantId}:${id ?? ''}` : (id ?? '')),
    queryFn: async () => {
      const res = await apiClient.get<WorkbookJob>(`/backup/jobs/${id}`, {
        ...(tenantId ? { _tenantOverride: tenantId } : {}),
      });
      return res.data;
    },
    enabled: id !== undefined,
    retry: shouldRetryQuery,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'RUNNING' || status === 'QUEUED' ? 2000 : false;
    },
  });
}

/** `POST /backup/export` — kicks off a new export job. Not idempotent
 * (each call queues a fresh job), so `retry: false`, same reasoning as
 * `bulk-upload.ts`'s multipart mutations. */
export function useRequestBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ job_id: string }> => {
      const res = await apiClient.post<{ job_id: string }>('/backup/export');
      return res.data;
    },
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: backupKeys.lists() });
    },
  });
}

/** `POST /backup/validate` — multipart upload of a candidate restore
 * workbook, staged and inspected server-side without writing anything.
 * The server's `ValidateResponseDto` is flat; this reshapes it into
 * `PreviewResult<RestoreSummary>` so it satisfies `BulkUploadPreview`'s
 * generic contract without changing the server response shape. */
/** [14.13.3] `tenantId` — see `useBackupJob`'s own comment on the same
 * option: set only by the SUPER_ADMIN provision-from-workbook flow to
 * validate against a school that isn't the caller's active tenant yet. */
export function useValidateBackup(options: { tenantId?: string } = {}) {
  const { tenantId } = options;
  return useMutation({
    mutationFn: async ({
      file,
      onProgress,
    }: {
      file: File;
      onProgress?: (percent: number) => void;
    }): Promise<PreviewResult<RestoreSummary>> => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post<ValidateResponseDto>('/backup/validate', formData, {
        ...(tenantId ? { _tenantOverride: tenantId } : {}),
        onUploadProgress: (event) => {
          if (onProgress && event.total) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        },
      });
      const data = res.data;
      return {
        staging_id: data.staging_id,
        expires_at: data.expires_at,
        errors: data.errors,
        hard_error_count: data.hard_error_count,
        summary: {
          meta: data.meta,
          tabs: data.tabs,
          totals: data.totals,
          warnings: data.warnings,
          is_empty_tenant: data.is_empty_tenant,
        },
      };
    },
    retry: false,
  });
}

/** `POST /backup/restore` — actually applies a previously validated
 * backup. Consequential and non-idempotent (same reasoning as
 * `useRequestBackup`): `retry: false`. Resolves with `{job_id,
 * snapshot_job_id}` the moment the restore is queued (202) — invalidates
 * the job list since a restore also creates a tracked job, but the caller
 * must poll `useBackupJob(job_id)` itself for progress. */
/** [14.13.3] `tenantId` — same option as `useValidateBackup`/`useBackupJob`.
 * When set, the ambient-tenant job list is deliberately NOT invalidated:
 * that list belongs to whatever tenant the caller is actually viewing, not
 * the just-provisioned school this restore targets. */
export function useRestoreBackup(options: { tenantId?: string } = {}) {
  const { tenantId } = options;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RestoreBackupInput): Promise<RequestRestoreResponse> => {
      const res = await apiClient.post<RequestRestoreResponse>('/backup/restore', input, {
        ...(tenantId ? { _tenantOverride: tenantId } : {}),
      });
      return res.data;
    },
    retry: false,
    onSuccess: () => {
      if (!tenantId) {
        void queryClient.invalidateQueries({ queryKey: backupKeys.lists() });
      }
    },
  });
}

/** `PATCH /backup/jobs/:id/pin` — pin or unpin a backup job (a pinned job
 * is exempt from retention pruning). Optimistic-free, same reasoning as
 * `useRequestBackup`/`useRestoreBackup`: invalidates the job list on
 * success rather than writing the cache by hand. */
export function usePinBackupJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }): Promise<WorkbookJob> => {
      const res = await apiClient.patch<WorkbookJob>(`/backup/jobs/${id}/pin`, { pinned });
      return res.data;
    },
    retry: false,
    // Both keys: the list is what the Settings table renders, but a
    // mounted `useBackupJob(id)` detail (a terminal job has stopped
    // polling, so nothing else would refresh it) would otherwise keep
    // showing the old `pinned` value.
    onSuccess: (_job, { id }) => {
      void queryClient.invalidateQueries({ queryKey: backupKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: backupKeys.detail(id) });
    },
    // 410 means retention deleted this job between the list render and the
    // click (the server's conditional pin update matched no live row). The
    // cached row is stale, so refetch rather than leave a "Pin" button on a
    // backup that no longer exists. Other errors leave the cache alone —
    // the row is still real, the request just failed.
    onError: (err, { id }) => {
      if (extractHttpStatus(err) !== 410) return;
      void queryClient.invalidateQueries({ queryKey: backupKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: backupKeys.detail(id) });
    },
  });
}

/** Reads an axios-shaped or fetch-shaped error's HTTP status code. */
function extractHttpStatus(err: unknown): number | undefined {
  const asRecord = err as { response?: { status?: number }; status?: number } | undefined;
  return asRecord?.response?.status ?? asRecord?.status;
}

/** One school's row from `GET /platform/backups/health` — mirrors
 * `PlatformSchoolBackupHealthDto`
 * (`server/src/modules/workbook/schedule/dto/platform-backup-health.dto.ts`).
 * `last_status`/`last_success_at` are both `null` for a school that has
 * never attempted a backup — the "never" row `BackupHealthTable` renders. */
export interface PlatformSchoolBackupHealth {
  school_id: string;
  name: string;
  schedule: 'OFF' | 'WEEKLY' | 'DAILY';
  last_success_at: string | null;
  last_status: WorkbookJobStatus | null;
  storage_total_bytes: string;
}

const platformBackupHealthKeys = createEntityKeys('platform-backup-health');

/** [14.12.3/#617] `GET /platform/backups/health` — SUPER_ADMIN only. One
 * row per school so a super admin can see who is and isn't backed up. */
export function usePlatformBackupHealth() {
  return useQuery({
    queryKey: platformBackupHealthKeys.lists(),
    queryFn: async () => {
      const res = await apiClient.get<{ data: PlatformSchoolBackupHealth[] }>(
        '/platform/backups/health',
      );
      return res.data.data;
    },
    retry: shouldRetryQuery,
  });
}

/** Reads the filename `Content-Disposition: attachment; filename="..."`
 * (optionally `filename*=UTF-8''...`) carries. Falls back to a generic
 * name when the header is missing or unparsable — a download should never
 * hard-fail just because the filename couldn't be recovered. */
function filenameFromContentDisposition(header: string | undefined, fallback: string): string {
  if (!header) return fallback;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // fall through to the plain filename= match below
    }
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(header);
  return plainMatch?.[1] ?? fallback;
}

/**
 * `GET /backup/jobs/:id/download` — an authenticated download: goes
 * through `apiClient` (its request interceptor attaches
 * `X-Tenant-ID`/`X-Role`/`Authorization`, and its response interceptor
 * handles a 401 mid-download with the same single-flight refresh every
 * other `apiClient` call gets) rather than a bare unauthenticated `fetch`,
 * fetches the archive as a `Blob`, then triggers a save via a throwaway
 * anchor element — the same client-side-only mechanism a plain
 * `<a download>` link uses, just built at call time since the URL needs
 * auth headers a plain link can't attach.
 */
export async function downloadBackup(
  id: string,
  options: { tenantId?: string } = {},
): Promise<void> {
  const { tenantId } = options;
  const res = await apiClient.get<Blob>(`/backup/jobs/${id}/download`, {
    responseType: 'blob',
    ...(tenantId ? { _tenantOverride: tenantId } : {}),
  });
  const filename = filenameFromContentDisposition(
    res.headers['content-disposition'] as string | undefined,
    `backup-${id}.zip`,
  );
  const url = URL.createObjectURL(res.data);
  // Revoke on a later tick, not in a `finally` right after click(): Safari
  // aborts an in-flight download if the object URL is revoked in the same
  // tick (see `../utils/csv.ts`'s `downloadCsv`, which this mirrors).
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * `GET /backup/template?lang=<lang>` — [14.13.1]'s blank workbook (header
 * rows, one SAMPLE row per sheet, enum/bool dropdowns, a `_readme` sheet),
 * for a school migrating in from paper or another system. Distinct from
 * `downloadTemplate` in client-admin's `students/import.tsx` (per-student
 * CSV template, unrelated endpoint) — this one is the whole-school
 * workbook, gated server-side by `BACKUP_MANAGE`. Same auth'd-blob-then-
 * anchor mechanism as `downloadBackup` above, for the same reason: the
 * URL needs auth headers a plain `<a>` can't attach.
 */
export async function downloadWorkbookTemplate(
  lang: 'bn' | 'en',
  options: { tenantId?: string } = {},
): Promise<void> {
  const { tenantId } = options;
  const res = await apiClient.get<Blob>('/backup/template', {
    params: { lang },
    responseType: 'blob',
    ...(tenantId ? { _tenantOverride: tenantId } : {}),
  });
  const filename = filenameFromContentDisposition(
    res.headers['content-disposition'] as string | undefined,
    `biddaloy-template-${lang}.xlsx`,
  );
  const url = URL.createObjectURL(res.data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
