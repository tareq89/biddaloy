import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import { ApiError } from '../api/errors';

import { studentKeys } from './students';
import type { BulkImportError, PreviewResult } from './use-bulk-upload-preview';

/**
 * Hand-declared to mirror the server's `BulkUploadPreviewRowDto` /
 * `BulkUploadValidateResultDto` at
 * `server/src/modules/students/dto/students.dto.ts` (added by [14.9.1]).
 * `schema.d.ts` has not been regenerated for these new endpoints yet — swap
 * this for the generated `components['schemas'][...]` type once it has,
 * same convention `use-bulk-upload-preview.ts`'s `BulkImportError` follows.
 */
export interface StudentUploadPreviewRow {
  row: number;
  student_name: string;
  class: string;
  section: string;
  guardian1_phone: string;
}

export interface StudentUploadSummary {
  rows_to_create: number;
  preview: StudentUploadPreviewRow[];
}

/** Mirrors `BulkUploadResultDto` — unchanged in shape by [14.9.1], just
 * returned from `/commit` now instead of the single upload route. */
export interface BulkUploadError {
  row: number;
  field?: string;
  value?: string;
  reason: string;
}

export interface BulkUploadResult {
  total_rows: number;
  success_count: number;
  error_count: number;
  created_student_ids: string[];
  errors: BulkUploadError[];
}

/**
 * `err.response?.status` (axios) — the shape `useBulkUploadPreview`'s
 * `extractHttpStatus` reads — but `apiClient`'s interceptor throws an
 * `ApiError` with `statusCode`, not a raw axios error. Without this, a
 * 404/410 (expired/consumed stage) would be treated as a generic failure
 * instead of `reason: 'expired'`.
 */
function withHttpStatusShape(error: unknown): unknown {
  if (error instanceof ApiError) {
    return Object.assign(new Error(error.message), { status: error.statusCode });
  }
  return error;
}

/**
 * [14.9.1] — `POST /students/bulk-upload/validate`, multipart field name
 * exactly `file`. Writes nothing; stages the accepted rows server-side and
 * returns a `PreviewResult` shaped for `BulkUploadPreview`/
 * `useBulkUploadPreview`.
 */
export function useValidateStudentUpload() {
  return useMutation({
    mutationFn: async ({
      file,
      onProgress,
    }: {
      file: File;
      onProgress?: (percent: number) => void;
    }): Promise<PreviewResult<StudentUploadSummary>> => {
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await apiClient.post<{
          staging_id: string;
          expires_at: string;
          rows_to_create: number;
          preview: StudentUploadPreviewRow[];
          // `validate` already answers in `BulkImportError`'s shape
          // (column/message/severity) — it returns the generic workbook
          // `BulkImportErrorDto`, not the commit-side `field`/`reason` one.
          // Mapping these through `toPreviewError` read `e.field`/`e.reason`,
          // both undefined here, so every row of the preview table rendered
          // with a null column and a blank message.
          errors: BulkImportError[];
          hard_error_count: number;
        }>('/students/bulk-upload/validate', formData, {
          onUploadProgress: (event) => {
            if (onProgress && event.total) {
              onProgress(Math.round((event.loaded / event.total) * 100));
            }
          },
        });
        const body = res.data;
        return {
          staging_id: body.staging_id,
          expires_at: body.expires_at,
          errors: body.errors,
          hard_error_count: body.hard_error_count,
          summary: { rows_to_create: body.rows_to_create, preview: body.preview },
        };
      } catch (error) {
        throw withHttpStatusShape(error);
      }
    },
    retry: false,
  });
}

/**
 * [14.9.1] — `POST /students/bulk-upload/commit`. Only actually writes
 * anything; a validate-only call never reaches this endpoint.
 */
export function useCommitStudentUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stagingId: string): Promise<BulkUploadResult> => {
      try {
        const res = await apiClient.post<BulkUploadResult>('/students/bulk-upload/commit', {
          staging_id: stagingId,
        });
        return res.data;
      } catch (error) {
        throw withHttpStatusShape(error);
      }
    },
    retry: false,
    onSuccess: (result) => {
      // Any successfully created row changes what the students list shows.
      // Whole `lists()` branch, not one filter variant — same convention
      // as `useCreateStudent`.
      if (result.success_count > 0) {
        void queryClient.invalidateQueries({ queryKey: studentKeys.lists() });
      }
    },
  });
}
