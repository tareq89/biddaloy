import type { HomeworkAssignmentStatus, HomeworkGradingMode } from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { withHttpStatusShape } from './bulk-upload';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import type { BulkImportError, PreviewResult } from './use-bulk-upload-preview';

// TODO(schema): swap for components['schemas'][...] once schema.d.ts is regenerated for 22.3.x
export interface Homework {
  id: string;
  subject_id: string;
  class_id: string;
  title: string;
  description: string | null;
  grading_mode: HomeworkGradingMode;
  attachments: unknown[];
  created_at: string;
}

export interface HomeworkAssignment {
  id: string;
  homework_id: string;
  section_id: string | null;
  student_id: string | null;
  assigned_date: string;
  due_date: string;
  status: HomeworkAssignmentStatus;
}

export interface HomeworkListFilters {
  class_id?: string;
  section_id?: string;
  subject_id?: string;
  status?: HomeworkAssignmentStatus;
}

export interface CreateHomeworkInput {
  subject_id: string;
  class_id: string;
  title: string;
  description?: string;
  grading_mode: HomeworkGradingMode;
}

export interface AssignHomeworkInput {
  section_id?: string;
  student_id?: string;
  assigned_date: string;
  due_date: string;
}

export const homeworkKeys = createEntityKeys<HomeworkListFilters>('homework');

export function homeworkListQueryOptions(filters: HomeworkListFilters = {}) {
  const queryKey = homeworkKeys.list(filters);
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<Homework[]>('/homework', { params: filters, signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useHomeworkList(filters: HomeworkListFilters = {}) {
  return useQuery(homeworkListQueryOptions(filters));
}

export function homeworkQueryOptions(id: string) {
  return queryOptions({
    queryKey: homeworkKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<Homework>(`/homework/${id}`, { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useHomework(id: string | undefined) {
  return useQuery({ ...homeworkQueryOptions(id ?? ''), enabled: id !== undefined });
}

export function useCreateHomework() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateHomeworkInput) => {
      const res = await apiClient.post<Homework>('/homework', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: homeworkKeys.lists() });
    },
  });
}

/**
 * The homework id goes in the mutation variables, not the hook argument —
 * `new.tsx` only learns it mid-submit, after `useCreateHomework` resolves.
 * Invalidates the list because its `section_id`/`status` filters join on
 * assignments.
 */
export function useAssignHomework() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      homeworkId,
      input,
    }: {
      homeworkId: string;
      input: AssignHomeworkInput;
    }) => {
      const res = await apiClient.post<HomeworkAssignment>(`/homework/${homeworkId}/assign`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: homeworkKeys.lists() });
    },
  });
}

// TODO(schema): hand-declared to mirror `HomeworkBulkUploadPreviewRowDto` /
// `HomeworkBulkUploadResultDto` at
// `server/src/modules/homework/dto/homework-bulk-upload.dto.ts` — swap for
// the generated `components['schemas'][...]` type once `schema.d.ts` is
// regenerated for these routes, same convention `bulk-upload.ts`'s
// `StudentUploadPreviewRow` follows.
export interface HomeworkUploadPreviewRow {
  row: number;
  class: string;
  section: string;
  subject: string;
  assigned_date: string;
  due_date: string;
}

export interface HomeworkUploadSummary {
  rows_to_create: number;
  preview: HomeworkUploadPreviewRow[];
}

export interface HomeworkUploadResult {
  total_rows: number;
  success_count: number;
  error_count: number;
  created_homework_ids: string[];
  errors: { row: number; field?: string; value?: string; reason: string }[];
}

/** [22.4.4] — `POST /homework/bulk/validate`, multipart field `file`. */
export function useValidateHomeworkUpload() {
  return useMutation({
    mutationFn: async ({
      file,
      onProgress,
    }: {
      file: File;
      onProgress?: (percent: number) => void;
    }): Promise<PreviewResult<HomeworkUploadSummary>> => {
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await apiClient.post<{
          staging_id: string;
          expires_at: string;
          rows_to_create: number;
          preview: HomeworkUploadPreviewRow[];
          errors: BulkImportError[];
          hard_error_count: number;
        }>('/homework/bulk/validate', formData, {
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

/** [22.4.4] — `POST /homework/bulk/commit`. */
export function useCommitHomeworkUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stagingId: string): Promise<HomeworkUploadResult> => {
      try {
        const res = await apiClient.post<HomeworkUploadResult>('/homework/bulk/commit', {
          staging_id: stagingId,
        });
        return res.data;
      } catch (error) {
        throw withHttpStatusShape(error);
      }
    },
    retry: false,
    onSuccess: (result) => {
      if (result.success_count > 0) {
        void queryClient.invalidateQueries({ queryKey: homeworkKeys.lists() });
      }
    },
  });
}
