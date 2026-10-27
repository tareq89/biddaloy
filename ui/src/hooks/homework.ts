import type {
  HomeworkAssignmentStatus,
  HomeworkGradingMode,
  HomeworkSubmissionStatus,
} from '@biddaloy/shared';
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

/** `GET /homework/:id/assignments` row: the assignment plus its target as names. */
export interface HomeworkAssignmentListItem extends HomeworkAssignment {
  target_section_id: string;
  section_name: string;
  student_name: string | null;
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

/** Prefix of every homework's assignments query; invalidate this after any assignment write. */
export const homeworkAssignmentsKeyRoot = [...homeworkKeys.all, 'assignments'] as const;
const assignmentsKey = (homeworkId: string) => [...homeworkAssignmentsKeyRoot, homeworkId] as const;

/** Mirrors `HomeworkAnalyticsService`'s `CompletionRollup` (server side,
 * `server/src/modules/homework/homework-analytics.service.ts`) — no case
 * transform in between, the controller returns the service result as-is. */
export interface HomeworkCompletionRollup {
  totalAssignments: number;
  completed: number;
  defaulters: number;
  completionPercent: number;
}

export interface HomeworkClassRollup extends HomeworkCompletionRollup {
  syllabus: {
    totalTopics: number;
    done: number;
    completionPercent: number;
  };
}

/** [22.4.6] D13/D29 read-only rollups, `GET /homework/analytics/{student,section,class}/:id`. */
export function studentHomeworkRollupQueryOptions(studentId: string) {
  return queryOptions({
    queryKey: [...homeworkKeys.all, 'analytics', 'student', studentId] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<HomeworkCompletionRollup>(
        `/homework/analytics/student/${studentId}`,
        { signal },
      );
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useStudentHomeworkRollup(studentId: string) {
  return useQuery(studentHomeworkRollupQueryOptions(studentId));
}

export function classHomeworkRollupQueryOptions(classId: string) {
  return queryOptions({
    queryKey: [...homeworkKeys.all, 'analytics', 'class', classId] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<HomeworkClassRollup>(`/homework/analytics/class/${classId}`, {
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useClassHomeworkRollup(classId: string) {
  return useQuery(classHomeworkRollupQueryOptions(classId));
}

/** [47.4.2] `GET /homework/analytics/section/:sectionId` — counts for the My class card (D25). */
export function sectionHomeworkRollupQueryOptions(sectionId: string) {
  return queryOptions({
    queryKey: [...homeworkKeys.all, 'analytics', 'section', sectionId] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<HomeworkCompletionRollup>(
        `/homework/analytics/section/${sectionId}`,
        { signal },
      );
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useSectionHomeworkRollup(sectionId: string) {
  return useQuery(sectionHomeworkRollupQueryOptions(sectionId));
}

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

export function homeworkAssignmentsQueryOptions(homeworkId: string) {
  return queryOptions({
    queryKey: assignmentsKey(homeworkId),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<HomeworkAssignmentListItem[]>(
        `/homework/${homeworkId}/assignments`,
        { signal },
      );
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useHomeworkAssignments(homeworkId: string | undefined) {
  return useQuery({
    ...homeworkAssignmentsQueryOptions(homeworkId ?? ''),
    enabled: homeworkId !== undefined,
  });
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
    retry: false,
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
      void queryClient.invalidateQueries({ queryKey: homeworkAssignmentsKeyRoot });
    },
  });
}

/**
 * Supersedes one assignment row with a new one (`POST /homework-assignments/:id/reassign`).
 * Refreshes on error too: a 400 means someone already changed that row.
 */
export function useReassignHomeworkAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({
      assignmentId,
      input,
    }: {
      assignmentId: string;
      input: AssignHomeworkInput;
    }) => {
      const res = await apiClient.post<HomeworkAssignment>(
        `/homework-assignments/${assignmentId}/reassign`,
        input,
      );
      return res.data;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: homeworkAssignmentsKeyRoot });
      void queryClient.invalidateQueries({ queryKey: homeworkKeys.lists() });
      // Only ACTIVE rows count on the "Homework to check" card.
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'widget'] });
    },
  });
}

export interface UpdateHomeworkAssignmentInput {
  status?: 'ACTIVE' | 'DEACTIVATED';
  /** `YYYY-MM-DD`; edits the row in place, so submissions stay. */
  due_date?: string;
}

/** `PATCH /homework-assignments/:id`. Refreshes on error too: a 400/404 means the row changed. */
export function useUpdateHomeworkAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({
      assignmentId,
      input,
    }: {
      assignmentId: string;
      input: UpdateHomeworkAssignmentInput;
    }) => {
      const res = await apiClient.patch<HomeworkAssignment>(
        `/homework-assignments/${assignmentId}`,
        input,
      );
      return res.data;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: homeworkAssignmentsKeyRoot });
      void queryClient.invalidateQueries({ queryKey: homeworkKeys.lists() });
      // Only ACTIVE rows count on the "Homework to check" card.
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'widget'] });
    },
  });
}

/** `GET /homework-assignments/:id/submissions` row (#2899): one per student; `submission_id` is
 * null until the student uploads or a teacher marks them. TODO(schema) like the types above. */
export interface HomeworkSubmissionRosterRow {
  student_id: string;
  student_name: string;
  roll_number: number;
  submission_id: string | null;
  status: HomeworkSubmissionStatus;
  marks: number | null;
  attachment_count: number;
}

export interface GradeSubmissionItem {
  student_id: string;
  status?: 'NOT_SUBMITTED' | 'PARTIAL' | 'DONE';
  marks?: number | null;
}

const submissionsKey = (assignmentId: string) =>
  [...homeworkKeys.all, 'submissions', assignmentId] as const;

export function assignmentSubmissionsQueryOptions(assignmentId: string) {
  return queryOptions({
    queryKey: submissionsKey(assignmentId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<HomeworkSubmissionRosterRow[]>(
          `/homework-assignments/${assignmentId}/submissions`,
          { signal },
        )
      ).data,
    retry: shouldRetryQuery,
  });
}

export function useAssignmentSubmissions(assignmentId: string | undefined) {
  return useQuery({
    ...assignmentSubmissionsQueryOptions(assignmentId ?? ''),
    enabled: assignmentId !== undefined,
  });
}

/** `PATCH /homework-assignments/:id/submissions`: one transaction for the whole Save. Refreshes
 * the list and the dashboard cards (the "Homework to check" count moves) on success only, so a
 * 500 keeps the teacher's unsaved draft. */
export function useGradeSubmissions() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({
      assignmentId,
      items,
    }: {
      assignmentId: string;
      items: GradeSubmissionItem[];
    }) =>
      (
        await apiClient.patch<HomeworkSubmissionRosterRow[]>(
          `/homework-assignments/${assignmentId}/submissions`,
          { items },
        )
      ).data,
    onSuccess: (data, { assignmentId }) => {
      // The PATCH reply is the fresh roster: seed it so the grid re-baselines clean.
      queryClient.setQueryData(submissionsKey(assignmentId), data);
      void queryClient.invalidateQueries({ queryKey: submissionsKey(assignmentId) });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'widget'] });
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
