import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { shouldRetryQuery } from './retry';

export type AcademicTerm = components['schemas']['TermResponseDto'];
export type CreateTermInput = components['schemas']['CreateTermDto'];
export type UpdateTermInput = components['schemas']['UpdateTermDto'];
export type ReorderTermsInput = components['schemas']['ReorderTermsDto'];

export const termKeys = {
  all: ['calendar-terms'] as const,
  list: (academicYearId: string) => ['calendar-terms', 'list', academicYearId] as const,
};

/**
 * `GET /calendar/terms` — a year's terms, ordered by `seq`. Small,
 * unpaginated list (a year has a handful of terms at most, same reasoning
 * `classSectionsQueryOptions` documents for a class's sections).
 */
export function termsQueryOptions(academicYearId: string | undefined) {
  return queryOptions({
    queryKey: termKeys.list(academicYearId ?? ''),
    queryFn: async () => {
      const res = await apiClient.get<AcademicTerm[]>('/calendar/terms', {
        params: { academic_year_id: academicYearId },
      });
      return res.data;
    },
    enabled: academicYearId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useTerms(academicYearId: string | undefined) {
  return useQuery(termsQueryOptions(academicYearId));
}

export function useCreateTerm(academicYearId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CreateTermInput, 'academic_year_id'>) => {
      const res = await apiClient.post<AcademicTerm>('/calendar/terms', {
        ...input,
        academic_year_id: academicYearId,
      });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: termKeys.list(academicYearId) });
    },
  });
}

export function useUpdateTerm(academicYearId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateTermInput & { id: string }) => {
      const res = await apiClient.patch<AcademicTerm>(`/calendar/terms/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: termKeys.list(academicYearId) });
    },
  });
}

export function useDeleteTerm(academicYearId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/calendar/terms/${id}`);
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: termKeys.list(academicYearId) });
    },
  });
}

export function useReorderTerms(academicYearId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiClient.post<AcademicTerm[]>('/calendar/terms/reorder', {
        academic_year_id: academicYearId,
        ids,
      });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: termKeys.list(academicYearId) });
    },
  });
}
