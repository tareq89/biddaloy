import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type Subject = components['schemas']['Subject'];
export type ClassSubject = components['schemas']['ClassSubject'];
export type CreateSubjectInput = components['schemas']['CreateSubjectDto'];
export type UpdateSubjectInput = components['schemas']['UpdateSubjectDto'];
export type AttachClassSubjectInput = components['schemas']['AttachClassSubjectDto'];

export interface PaginatedSubjects {
  data: Subject[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SubjectListFilters {
  is_active?: boolean;
  page?: number;
  limit?: number;
}

export const subjectKeys = createEntityKeys<SubjectListFilters>('subjects');

// [9.1] Same "no wire pagination needed" reasoning as `classesQueryOptions`'s
// `CLASS_FILTER_LIMIT` — a school's whole subject list comfortably fits one
// page, so a dropdown/tab caller can default to a generous limit rather than
// paging through a `<select>`.
const SUBJECT_FILTER_LIMIT = 100;

export function subjectsQueryOptions(filters: SubjectListFilters = {}) {
  const params = { limit: SUBJECT_FILTER_LIMIT, ...filters };
  const queryKey = subjectKeys.list(params);
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedSubjects>('/subjects', { params, signal });
      return res.data;
    },
    retry: shouldRetryQuery,
    placeholderData: keepPreviousData,
  });
}

export function useSubjects(filters: SubjectListFilters = {}) {
  return useQuery(subjectsQueryOptions(filters));
}

/** `classId`/`academicYearId`-scoped: which subjects a class offers in a
 * given academic year — the class detail page's Subjects tab. */
export function classSubjectsKey(classId: string | undefined, academicYearId: string | undefined) {
  return [...subjectKeys.all, 'class', classId, academicYearId] as const;
}

export function classSubjectsQueryOptions(
  classId: string | undefined,
  academicYearId: string | undefined,
) {
  const queryKey = classSubjectsKey(classId, academicYearId);
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ClassSubject[]>(`/classes/${classId}/subjects`, {
        params: { academic_year_id: academicYearId },
        signal,
      });
      return res.data;
    },
    enabled: classId !== undefined && academicYearId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useClassSubjects(classId: string | undefined, academicYearId: string | undefined) {
  return useQuery(classSubjectsQueryOptions(classId, academicYearId));
}

export function useCreateSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSubjectInput) => {
      const res = await apiClient.post<Subject>('/subjects', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: subjectKeys.lists() });
    },
  });
}

export function useUpdateSubject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSubjectInput) => {
      const res = await apiClient.patch<Subject>(`/subjects/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: subjectKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: subjectKeys.detail(id) });
    },
  });
}

export function useDeleteSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/subjects/${id}`);
    },
    retry: shouldRetryQuery,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: subjectKeys.lists() });
      queryClient.removeQueries({ queryKey: subjectKeys.detail(id) });
    },
  });
}

export function useAttachClassSubject(classId: string, academicYearId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AttachClassSubjectInput) => {
      const res = await apiClient.post<ClassSubject>(`/classes/${classId}/subjects`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: classSubjectsKey(classId, academicYearId) });
    },
  });
}

export function useDetachClassSubject(classId: string, academicYearId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (subjectId: string) => {
      await apiClient.delete(`/classes/${classId}/subjects/${subjectId}`, {
        params: { academic_year_id: academicYearId },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: classSubjectsKey(classId, academicYearId) });
    },
  });
}
