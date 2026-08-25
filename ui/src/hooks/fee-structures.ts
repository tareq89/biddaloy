import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type FeeStructure = components['schemas']['FeeStructure'];
export type FeeStructureStudent = components['schemas']['FeeStructureStudent'];
export type CreateFeeStructureInput = components['schemas']['CreateFeeStructureDto'];
export type UpdateFeeStructureInput = components['schemas']['UpdateFeeStructureDto'];

/** `GET /fee-structures`'s 200 body untyped in `schema.d.ts` — same gap
 * `students.ts`'s `PaginatedStudents` documents for the sibling endpoint. */
export interface PaginatedFeeStructures {
  data: FeeStructure[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FeeStructureListFilters {
  academic_year_id?: string;
  class_id?: string;
  month?: number;
  page?: number;
  limit?: number;
}

export const feeStructureKeys = createEntityKeys<FeeStructureListFilters>('fee-structures');

export function feeStructuresQueryOptions(filters: FeeStructureListFilters = {}) {
  return queryOptions({
    queryKey: feeStructureKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedFeeStructures>('/fee-structures', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useFeeStructures(filters: FeeStructureListFilters = {}) {
  return useQuery(feeStructuresQueryOptions(filters));
}

/** Only `GET /fee-structures/:id` hydrates `selected_students` — the list
 * endpoint deliberately omits the relation — so the edit dialog's student
 * picker has to prefill from this detail query, not from the list row. */
export function feeStructureQueryOptions(id: string) {
  return queryOptions({
    queryKey: feeStructureKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<FeeStructure>(`/fee-structures/${id}`, { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useFeeStructure(id: string | undefined) {
  return useQuery({ ...feeStructureQueryOptions(id ?? ''), enabled: id !== undefined });
}

export function useCreateFeeStructure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateFeeStructureInput) => {
      const res = await apiClient.post<FeeStructure>('/fee-structures', input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feeStructureKeys.lists() });
    },
  });
}

export function useUpdateFeeStructure(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateFeeStructureInput) => {
      const res = await apiClient.patch<FeeStructure>(`/fee-structures/${id}`, input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feeStructureKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: feeStructureKeys.lists() });
    },
  });
}

export function useDeleteFeeStructure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/fee-structures/${id}`);
    },
    retry: shouldRetryQuery,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: feeStructureKeys.lists() });
      queryClient.removeQueries({ queryKey: feeStructureKeys.detail(id) });
    },
  });
}
