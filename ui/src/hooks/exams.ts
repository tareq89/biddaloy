/**
 * [19.6.1] Exams client hooks — exam CRUD, exam-component CRUD + copy,
 * grid-submission progress, and a student's fourth-subject choice.
 * Mirrors `classes.ts`'s shape (query-key factory, `offlineCachedQueryFn`
 * only where a list is genuinely worth reading offline — exams/components
 * skip it, same as `subjects.ts`, since these are low-traffic staff-admin
 * screens, not a field-worker list).
 *
 * `progress`/`listOptions`/`copy`'s response bodies have no `@ApiResponse`
 * decoration server-side (see `mark-grid.service.ts#progress`,
 * `subject-choices.service.ts#listOptions`), so `schema.d.ts` types them
 * `content?: never` — hand-typed here against the service's actual return
 * shape, same gap `PaginatedClasses` documents for `/classes`.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type Exam = components['schemas']['Exam'];
export type CreateExamInput = components['schemas']['CreateExamDto'];
export type UpdateExamInput = components['schemas']['UpdateExamDto'];
export type ExamComponent = components['schemas']['ExamComponent'];
export type CreateExamComponentInput = components['schemas']['CreateExamComponentDto'];
export type UpdateExamComponentInput = components['schemas']['UpdateExamComponentDto'];
export type CopyExamComponentsInput = components['schemas']['CopyExamComponentsDto'];
export type SetSubjectChoiceInput = components['schemas']['SetSubjectChoiceDto'];

export interface PaginatedExams {
  data: Exam[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ExamListFilters {
  academic_year_id?: string;
  class_id?: string;
  page?: number;
  limit?: number;
}

export const examKeys = createEntityKeys<ExamListFilters>('exams');

export function examsQueryOptions(filters: ExamListFilters = {}) {
  const params = { limit: 10, ...filters };
  const queryKey = examKeys.list(params);
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedExams>('/exams', { params, signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useExams(filters: ExamListFilters = {}) {
  return useQuery(examsQueryOptions(filters));
}

export function examQueryOptions(id: string) {
  return queryOptions({
    queryKey: examKeys.detail(id),
    queryFn: async () => (await apiClient.get<Exam>(`/exams/${id}`)).data,
    retry: shouldRetryQuery,
  });
}

export function useExam(id: string | undefined) {
  return useQuery({ ...examQueryOptions(id ?? ''), enabled: id !== undefined });
}

export function useCreateExam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExamInput) =>
      (await apiClient.post<Exam>('/exams', input)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: examKeys.lists() }),
  });
}

export function useUpdateExam(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateExamInput) =>
      (await apiClient.patch<Exam>(`/exams/${id}`, input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: examKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: examKeys.lists() });
    },
  });
}

// --- Exam components ---

export function examComponentsKey(examId: string | undefined, subjectId: string | undefined) {
  return [...examKeys.all, 'components', examId, subjectId] as const;
}

export function examComponentsQueryOptions(
  examId: string | undefined,
  subjectId: string | undefined,
) {
  return queryOptions({
    queryKey: examComponentsKey(examId, subjectId),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ExamComponent[]>(`/exams/${examId}/components`, {
        params: subjectId ? { subject_id: subjectId } : {},
        signal,
      });
      return res.data;
    },
    enabled: examId !== undefined && subjectId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useExamComponents(examId: string | undefined, subjectId: string | undefined) {
  return useQuery(examComponentsQueryOptions(examId, subjectId));
}

/** Every component for an exam, across all subjects — the copy dialog's
 * preview needs to know what already exists in every candidate target
 * subject, not just the one currently open on the Setup tab. */
export function examComponentsAllQueryOptions(examId: string | undefined) {
  return queryOptions({
    queryKey: [...examComponentsKey(examId, undefined), 'all'] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ExamComponent[]>(`/exams/${examId}/components`, { signal });
      return res.data;
    },
    enabled: examId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useExamComponentsAll(examId: string | undefined) {
  return useQuery(examComponentsAllQueryOptions(examId));
}

export function useCreateExamComponent(examId: string, subjectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExamComponentInput) =>
      (await apiClient.post<ExamComponent>(`/exams/${examId}/components`, input)).data,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: examComponentsKey(examId, subjectId) }),
  });
}

export function useUpdateExamComponent(examId: string, subjectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateExamComponentInput }) =>
      (await apiClient.patch<ExamComponent>(`/exams/${examId}/components/${id}`, input)).data,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: examComponentsKey(examId, subjectId) }),
  });
}

export function useDeleteExamComponent(examId: string, subjectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/exams/${examId}/components/${id}`);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: examComponentsKey(examId, subjectId) }),
  });
}

/** D9 copy dialog's confirm step — `ExamComponentsService.copy`'s actual
 * created/skipped result. The dialog's *preview* (shown before this ever
 * fires) is computed client-side from already-fetched component lists —
 * see `-copy-components-dialog.tsx` — since the endpoint itself performs
 * the copy rather than offering a dry run. */
export interface CopyExamComponentsResult {
  copied: Array<{ subject_id: string; name: string }>;
  skipped: Array<{ subject_id: string; name: string; reason: string }>;
}

export function useCopyExamComponents(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CopyExamComponentsInput) =>
      (await apiClient.post<CopyExamComponentsResult>(`/exams/${examId}/components/copy`, input))
        .data,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: [...examKeys.all, 'components', examId] }),
  });
}

// --- Progress ---

export interface ExamProgress {
  counts: Record<'DRAFT' | 'SUBMITTED', number>;
  outstanding: Array<{
    section_id: string;
    section_name: string;
    subject_id: string;
    state: 'DRAFT' | 'SUBMITTED';
  }>;
}

export function examProgressQueryOptions(examId: string | undefined) {
  return queryOptions({
    queryKey: [...examKeys.all, 'progress', examId] as const,
    queryFn: async ({ signal }) =>
      (await apiClient.get<ExamProgress>(`/exams/${examId}/marks/progress`, { signal })).data,
    enabled: examId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useExamProgress(examId: string | undefined) {
  return useQuery(examProgressQueryOptions(examId));
}

// --- Subject choices (fourth subject) ---

export interface SubjectChoiceOption {
  class_subject_id: string;
  subject_id: string;
  chosen: boolean;
  is_fourth: boolean;
}

export function subjectChoiceOptionsKey(
  studentId: string | undefined,
  academicYearId: string | undefined,
) {
  return ['subject-choices', studentId, academicYearId] as const;
}

export function subjectChoiceOptionsQueryOptions(
  studentId: string | undefined,
  academicYearId: string | undefined,
) {
  return queryOptions({
    queryKey: subjectChoiceOptionsKey(studentId, academicYearId),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<SubjectChoiceOption[]>(
        `/students/${studentId}/subject-choices`,
        { params: { academic_year_id: academicYearId }, signal },
      );
      return res.data;
    },
    enabled: studentId !== undefined && academicYearId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useSubjectChoiceOptions(
  studentId: string | undefined,
  academicYearId: string | undefined,
) {
  return useQuery(subjectChoiceOptionsQueryOptions(studentId, academicYearId));
}

export function useSetSubjectChoice(studentId: string, academicYearId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetSubjectChoiceInput) => {
      await apiClient.put(`/students/${studentId}/subject-choices`, input);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: subjectChoiceOptionsKey(studentId, academicYearId),
      }),
  });
}
