import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import type { PreviewResult } from './use-bulk-upload-preview';

/**
 * Hand-declared to mirror the server's backup DTOs
 * (`server/src/modules/backup/dto/backup.dto.ts`, added by #600/#604/#609).
 * `schema.d.ts` has not been regenerated for these endpoints yet — swap
 * these for the generated `components['schemas'][...]` types once wave-3
 * integration regenerates it, same convention `bulk-upload.ts`'s
 * `StudentUploadPreviewRow` follows.
 */
export type BackupJobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

export interface BackupJob {
  id: string;
  status: BackupJobStatus;
  type: 'EXPORT' | 'RESTORE';
  created_at: string;
  completed_at?: string | null;
  requested_by?: string;
  error_message?: string | null;
  file_size_bytes?: number | null;
  /** [613] D5's `workbook_jobs.progress` fields, added for the restore
   * wizard's progress panel — optional so #612's `backup-section.tsx`
   * keeps compiling unchanged. */
  current_tab?: string | null;
  tabs_done?: number | null;
  tabs_total?: number | null;
  /** The tab the restore stopped at, set only when `status === 'FAILED'`. */
  failed_tab?: string | null;
  /** The pre-restore snapshot's own job id — the undo, per D8. */
  snapshot_job_id?: string | null;
  row_counts?: Record<string, number> | null;
}

export interface BackupJobListFilters {
  status?: BackupJobStatus;
  type?: 'EXPORT' | 'RESTORE';
  page?: number;
  limit?: number;
}

export interface PaginatedBackupJobs {
  data: BackupJob[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** One tab's diff counts in a restore preview — [613] C1. */
export interface RestoreTabDiff {
  tab: string;
  create: number;
  update: number;
  delete: number;
  unchanged: number;
  errors: number;
}

/**
 * [613] C1 — hand-declared to mirror #604's `ValidateResponseDto`, still a
 * guess pending schema regeneration (same convention as `BackupJob`'s own
 * header comment): swap for the generated `components['schemas'][...]`
 * type once wave-3 integration regenerates `schema.d.ts`. Replaces the old
 * `ValidateResponseDto`, which didn't satisfy `PreviewResult<S>` — no
 * `staging_id`/`expires_at`, `errors` typed `string[]`, no per-tab diff.
 */
export interface RestoreSummary {
  school_name: string;
  source_school_name?: string;
  exported_at?: string;
  is_empty_tenant: boolean;
  tabs: RestoreTabDiff[];
  warnings: string[];
  /** Relative path for the "download errors as CSV" link:
   * `/backup/validate/:staging_id/errors.csv`. */
  errors_csv_path?: string;
}

/**
 * [613] C2 — `commit` in `useBulkUploadPreview` is handed only the staged
 * upload's `staging_id` (D7: every bulk upload commits from the stage,
 * never a re-parsed file or a stored archive id), and D8 requires the
 * "invite restored users" opt-in. `#609` confirms the final field names at
 * wave-3 integration.
 */
export interface RestoreBackupInput {
  staging_id: string;
  confirmation_text: string;
  /** D8: restored users arrive without credentials; inviting them is
   * opt-in, default off. */
  invite_restored_users?: boolean;
}

/**
 * The reference query-key instance for this entity — see
 * `./query-keys.ts`'s own comment and `./students.ts`'s `studentKeys` for
 * the pattern every entity's keys mirror.
 */
export const backupKeys = createEntityKeys<BackupJobListFilters>('backup-jobs');

/** `GET /backup/jobs` — the list of export/restore jobs for the active
 * tenant, newest first (server-side ordering). */
export function useBackupJobs(filters: BackupJobListFilters = {}) {
  return useQuery({
    queryKey: backupKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedBackupJobs>('/backup/jobs', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

/** `GET /backup/jobs/:id` — polls every 2s while the job is still
 * `QUEUED`/`RUNNING` so the caller sees live progress, and stops polling
 * once it lands on a terminal status (`DONE`/`FAILED`). */
export function useBackupJob(id: string | undefined) {
  return useQuery({
    queryKey: backupKeys.detail(id ?? ''),
    queryFn: async () => {
      const res = await apiClient.get<BackupJob>(`/backup/jobs/${id}`);
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
    mutationFn: async (): Promise<BackupJob> => {
      const res = await apiClient.post<BackupJob>('/backup/export');
      return res.data;
    },
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: backupKeys.lists() });
    },
  });
}

/** `POST /backup/validate` — multipart upload of a candidate restore
 * archive, staged and inspected server-side without writing anything.
 * Writes nothing itself, so this mirrors `bulk-upload.ts`'s
 * `useValidateStudentUpload` shape (multipart + upload progress,
 * `retry: false`). */
export function useValidateBackup() {
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
      const res = await apiClient.post<PreviewResult<RestoreSummary>>(
        '/backup/validate',
        formData,
        {
          onUploadProgress: (event) => {
            if (onProgress && event.total) {
              onProgress(Math.round((event.loaded / event.total) * 100));
            }
          },
        },
      );
      return res.data;
    },
    retry: false,
  });
}

/** `POST /backup/restore` — actually applies a previously validated
 * backup. Consequential and non-idempotent (same reasoning as
 * `useRequestBackup`): `retry: false`, and invalidates the job list on
 * success since a restore also queues/creates a tracked job. */
export function useRestoreBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RestoreBackupInput): Promise<BackupJob> => {
      const res = await apiClient.post<BackupJob>('/backup/restore', input);
      return res.data;
    },
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: backupKeys.lists() });
    },
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
export async function downloadBackup(id: string): Promise<void> {
  const res = await apiClient.get<Blob>(`/backup/jobs/${id}/download`, {
    responseType: 'blob',
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
 * `GET <path>` for a `RestoreSummary.errors_csv_path` (e.g.
 * `/backup/validate/:staging_id/errors.csv`) — same authenticated-download
 * shape as `downloadBackup` above. A plain `<a href={path}>` would hit the
 * API host directly with no `Authorization` header attached, so it 401s;
 * this goes through `apiClient` like every other download in this file.
 */
export async function downloadValidationErrorsCsv(path: string): Promise<void> {
  const res = await apiClient.get<Blob>(path, { responseType: 'blob' });
  const filename = filenameFromContentDisposition(
    res.headers['content-disposition'] as string | undefined,
    'restore-errors.csv',
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
