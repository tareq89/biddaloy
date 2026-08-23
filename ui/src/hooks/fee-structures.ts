import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type FeeStructure = components['schemas']['FeeStructure'];

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
