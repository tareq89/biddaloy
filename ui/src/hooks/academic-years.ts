import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type AcademicYear = components['schemas']['AcademicYear'];
export type CreateAcademicYearInput = components['schemas']['CreateAcademicYearDto'];
export type UpdateAcademicYearInput = components['schemas']['UpdateAcademicYearDto'];

/** `GET /academic-years/:id/stats`'s 200 body untyped in `schema.d.ts` —
 * the controller never attached an `@ApiResponse` type, same gap
 * `students.ts`'s `PaginatedStudents` documents for a sibling endpoint —
 * so hand-typed against `academic-year.service.ts`'s `AcademicYearStats`. */
export interface AcademicYearStats {
  classes_count: number;
  students_count: number;
  fee_structures_count: number;
}

/** `GET /academic-years`'s 200 body — same untyped-list gap as above. */
export interface PaginatedAcademicYears {
  data: AcademicYear[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AcademicYearListFilters {
  page?: number;
  limit?: number;
}

export const academicYearKeys = createEntityKeys<AcademicYearListFilters>('academic-years');

export function academicYearsQueryOptions(filters: AcademicYearListFilters = {}) {
  return queryOptions({
    queryKey: academicYearKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedAcademicYears>('/academic-years', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useAcademicYears(filters: AcademicYearListFilters = {}) {
  return useQuery(academicYearsQueryOptions(filters));
}

export function academicYearQueryOptions(id: string) {
  return queryOptions({
    queryKey: academicYearKeys.detail(id),
    queryFn: async () => {
      const res = await apiClient.get<AcademicYear>(`/academic-years/${id}`);
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useAcademicYear(id: string | undefined) {
  return useQuery({ ...academicYearQueryOptions(id ?? ''), enabled: id !== undefined });
}

export function academicYearStatsQueryOptions(id: string) {
  return queryOptions({
    queryKey: [...academicYearKeys.detail(id), 'stats'] as const,
    queryFn: async () => {
      const res = await apiClient.get<AcademicYearStats>(`/academic-years/${id}/stats`);
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useAcademicYearStats(id: string | undefined) {
  return useQuery({ ...academicYearStatsQueryOptions(id ?? ''), enabled: id !== undefined });
}

export function useCreateAcademicYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAcademicYearInput) => {
      const res = await apiClient.post<AcademicYear>('/academic-years', input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: academicYearKeys.lists() });
    },
  });
}

export function useUpdateAcademicYear(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateAcademicYearInput) => {
      const res = await apiClient.patch<AcademicYear>(`/academic-years/${id}`, input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: academicYearKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: academicYearKeys.lists() });
    },
  });
}

export function useDeleteAcademicYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/academic-years/${id}`);
    },
    retry: shouldRetryQuery,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: academicYearKeys.lists() });
      queryClient.removeQueries({ queryKey: academicYearKeys.detail(id) });
    },
  });
}

/** `POST /academic-years/:id/set-current` unsets every other year for the
 * tenant (`academic-year.service.ts`'s `setCurrent`) — a side effect wide
 * enough that every list/detail entry, not just the target year, is
 * invalidated rather than patched in place. */
export function useSetCurrentAcademicYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<AcademicYear>(`/academic-years/${id}/set-current`);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: academicYearKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: academicYearKeys.details() });
    },
  });
}
