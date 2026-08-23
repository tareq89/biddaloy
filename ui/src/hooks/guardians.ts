import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type Guardian = components['schemas']['Guardian'];
export type CreateGuardianInput = components['schemas']['CreateGuardianDto'];

export interface GuardianListFilters {
  search?: string;
  page?: number;
  limit?: number;
}

/** `GET /api/v1/guardians`'s 200 body is untyped in `schema.d.ts` — same
 * gap `students.ts`'s `PaginatedStudents` documents for the sibling list
 * endpoint — hand-typed against the `{ data, total, page, limit,
 * totalPages }` envelope every list endpoint actually returns. */
export interface PaginatedGuardians {
  data: Guardian[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const guardianKeys = createEntityKeys<GuardianListFilters>('guardians');

/** Search-as-you-type result count kept small — this backs an inline
 * picker, not a browsable list page, so there's no pagination UI to page
 * through a large result set with. A caller debounces `filters.search`
 * itself (`useDebouncedValue`) before this fires. */
const GUARDIAN_SEARCH_LIMIT = 10;

export function guardiansQueryOptions(filters: GuardianListFilters) {
  return queryOptions({
    queryKey: guardianKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedGuardians>('/guardians', {
        params: { limit: GUARDIAN_SEARCH_LIMIT, ...filters },
        signal,
      });
      return res.data;
    },
    // A blank search returns the tenant's most recent guardians rather
    // than nothing — `enabled` isn't used to gate on non-empty search, so
    // opening the picker before typing still shows useful starting
    // options instead of an empty list.
    retry: shouldRetryQuery,
  });
}

export function useGuardians(filters: GuardianListFilters) {
  return useQuery(guardiansQueryOptions(filters));
}

/** The "create one inline" half of [8.10.3]'s guardian linking — a new
 * sibling's guardian usually already exists, but when they don't, this
 * lets the student form create one without leaving the page. Invalidates
 * every cached guardian list, same reasoning as `students.ts`'s
 * `useCreateStudent`: a new guardian can appear in any search-filtered
 * variant, not just whichever one happened to be showing. */
export function useCreateGuardian() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateGuardianInput) => {
      const res = await apiClient.post<Guardian>('/guardians', input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: guardianKeys.lists() });
    },
  });
}
