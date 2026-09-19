import type { CalendarImportRowStatus } from '@biddaloy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { calendarEventKeys } from './calendar-events';

/** `POST /calendar-import/validate`'s `CalendarImportValidateResponseDto`
 * — generated in `schema.d.ts` (unlike the still-hand-typed
 * `use-bulk-upload-preview.ts` shapes), so reuse the real type directly. */
export type CalendarImportValidateResponse =
  components['schemas']['CalendarImportValidateResponseDto'];
export type CalendarImportRow = components['schemas']['CalendarImportRowResponseDto'];
export type CalendarImportSummary = components['schemas']['CalendarImportSummaryDto'];

export type { CalendarImportRowStatus };

/**
 * `POST /calendar-import/commit`'s 201 body — hand-typed against
 * `CalendarImportCommitResponseDto` at
 * `server/src/modules/calendar/dto/calendar-import.dto.ts:108-118`.
 * `schema.d.ts` generates this endpoint's response as an untyped
 * `Record<string, never>` (the controller has no `@ApiResponse` type
 * attached), same generation gap `use-bulk-upload-preview.ts`'s
 * `PreviewResult` comment documents for a sibling endpoint. Swap for the
 * generated `components['schemas'][...]` type once that gap is closed.
 */
export interface CalendarImportCommitFailedRow {
  row: number;
  message: string;
}

export interface CalendarImportCommitResponse {
  created: number;
  updated: number;
  unchanged: number;
  failed: CalendarImportCommitFailedRow[];
}

/**
 * `POST /calendar-import/validate` — multipart upload, stages the parsed
 * rows server-side and returns a per-row `NEW`/`UPDATED`/`UNCHANGED`/
 * `ERROR` preview. Writes nothing; the actual write happens on
 * `useCommitCalendarImport`.
 */
export function useValidateCalendarImport() {
  return useMutation({
    mutationFn: async (file: File): Promise<CalendarImportValidateResponse> => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post<CalendarImportValidateResponse>(
        '/calendar-import/validate',
        formData,
      );
      return res.data;
    },
    retry: false,
  });
}

/**
 * `POST /calendar-import/commit` — single-use `staging_id` from the
 * preceding validate call. `publish` defaults to `false` server-side
 * (rows land as drafts) per the issue body's D9.
 */
export function useCommitCalendarImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      staging_id: string;
      publish?: boolean;
    }): Promise<CalendarImportCommitResponse> => {
      const res = await apiClient.post<CalendarImportCommitResponse>(
        '/calendar-import/commit',
        input,
      );
      return res.data;
    },
    retry: false,
    onSuccess: (result) => {
      if (result.created > 0 || result.updated > 0) {
        void queryClient.invalidateQueries({ queryKey: calendarEventKeys.all });
      }
    },
  });
}

/**
 * `POST /calendar/clone` — clones non-HOLIDAY published events from one
 * academic year into another as a *staged* import preview (same
 * `staging_id`/`expires_at`/`summary`/`rows` shape `validate` returns),
 * so the caller commits it through the same `useCommitCalendarImport`
 * flow the manual upload wizard uses. Writes nothing by itself.
 */
export function useCloneCalendar() {
  return useMutation({
    mutationFn: async (input: {
      source_year_id: string;
      target_year_id: string;
      event_ids?: string[];
    }): Promise<CalendarImportValidateResponse> => {
      const res = await apiClient.post<CalendarImportValidateResponse>(
        '/calendar/clone',
        input,
      );
      return res.data;
    },
    retry: false,
  });
}

function filenameFromContentDisposition(
  header: string | undefined,
  fallback: string,
): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

/** `GET /calendar-import/template` — downloads the blank spreadsheet
 * template the upload step points the admin at. Same auth-header-needs-
 * an-XHR-request reasoning as `downloadBackup`/`downloadWorkbookTemplate`
 * in `./backup.ts` — a plain `<a href>` can't carry the bearer/tenant
 * headers, so this fetches the blob and triggers the download itself. */
export async function downloadCalendarImportTemplate(
  format: 'xlsx' | 'csv' = 'xlsx',
): Promise<void> {
  const res = await apiClient.get<Blob>('/calendar-import/template', {
    params: { format },
    responseType: 'blob',
  });
  const filename = filenameFromContentDisposition(
    res.headers['content-disposition'] as string | undefined,
    `calendar-import-template.${format}`,
  );
  const url = URL.createObjectURL(res.data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on a later tick — Safari aborts an in-flight download if the
  // object URL is revoked in the same tick (mirrors `./backup.ts`).
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `GET /calendar/export?format=&academic_year_id=` — downloads the
 * tenant's current academic year calendar as a workbook. */
export async function downloadCalendarExport(
  academicYearId: string,
  format: 'xlsx' | 'csv' = 'xlsx',
): Promise<void> {
  const res = await apiClient.get<Blob>('/calendar/export', {
    params: { format, academic_year_id: academicYearId },
    responseType: 'blob',
  });
  const filename = filenameFromContentDisposition(
    res.headers['content-disposition'] as string | undefined,
    `calendar-export.${format}`,
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
