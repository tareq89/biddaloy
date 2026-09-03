import type { CommunicationMedium } from '@biddaloy/shared';
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

export type Guardian = components['schemas']['Guardian'];
export type CreateGuardianInput = components['schemas']['CreateGuardianDto'];
export type UpdateGuardianInput = components['schemas']['UpdateGuardianDto'];
// [8.14.4] `PATCH /guardians/mine`'s own DTO — narrower than
// `UpdateGuardianInput`: no `full_name`/`relationship`/`student_ids`, since
// those are the school's data about a family, not the PARENT's own contact
// details. See `UpdateOwnGuardianDto` in `schema.d.ts`.
export type UpdateOwnGuardianInput = components['schemas']['UpdateOwnGuardianDto'];

// [8.14.10] Mirrors `QueryGuardianDto`
// (`server/src/modules/students/dto/students.dto.ts`) exactly.
export interface GuardianListFilters {
  search?: string;
  relationship?: string;
  preferred_communication?: CommunicationMedium;
  is_primary_contact?: boolean;
  sort?: 'full_name' | 'created_at';
  order?: 'asc' | 'desc';
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

/** Default result count for the inline picker (`GuardianPicker`), which
 * never passes its own `limit` — search-as-you-type there has no
 * pagination UI to page a large result set through. [8.11.4]'s Guardians
 * list page is the other caller of `guardiansQueryOptions`/`useGuardians`
 * and *does* page through results, so it passes its own `filters.limit`
 * (from `useListShellState`'s page-size), which wins over this default. */
const GUARDIAN_SEARCH_LIMIT = 10;

export function guardiansQueryOptions(filters: GuardianListFilters) {
  // One object, used for both the cache key and the request params — a
  // caller-supplied `filters.limit` wins over the picker's default, kept
  // in the same object the cache key is built from so the two never
  // drift apart the way a param built separately from the key could.
  const effectiveFilters: GuardianListFilters = {
    ...filters,
    limit: filters.limit ?? GUARDIAN_SEARCH_LIMIT,
  };
  return queryOptions({
    queryKey: guardianKeys.list(effectiveFilters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedGuardians>('/guardians', {
        params: effectiveFilters,
        signal,
      });
      return res.data;
    },
    // A blank search returns the tenant's most recent guardians rather
    // than nothing — `enabled` isn't used to gate on non-empty search, so
    // opening the picker before typing still shows useful starting
    // options instead of an empty list.
    retry: shouldRetryQuery,
    // [8.14.6] Filter/page/sort changes keep the previous page's rows on
    // screen (and `isFetching` true) instead of the whole table collapsing
    // to one "Loading…" row height. v5 dropped `keepPreviousData: true`;
    // this is its replacement.
    placeholderData: keepPreviousData,
  });
}

export function useGuardians(filters: GuardianListFilters) {
  return useQuery(guardiansQueryOptions(filters));
}

/** [8.11.4]'s detail page — mirrors `students.ts`'s `studentQueryOptions`.
 * Split out from `useGuardian` so a loader (`context.queryClient
 * .ensureQueryData(guardianQueryOptions(id))`) can share the same cache
 * entry a hook can't reach outside render. */
export function guardianQueryOptions(id: string) {
  return queryOptions({
    queryKey: guardianKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<Guardian>(`/guardians/${id}`, { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useGuardian(id: string | undefined) {
  return useQuery({ ...guardianQueryOptions(id ?? ''), enabled: id !== undefined });
}

/** [8.14.4]'s `/portal/account` guardian-contact card — `GET
 * /guardians/mine`, PARENT-only (`students.controller.ts`'s own `@Roles`).
 * Ownership comes from the JWT, never a path id — the caller can only ever
 * read their own guardian record, so this needs no argument the way
 * `guardianQueryOptions(id)` does. Keyed under a literal `'mine'` segment,
 * same reasoning as `users.ts`'s `currentUserQueryOptions`. */
export function myGuardianQueryOptions() {
  return queryOptions({
    queryKey: [...guardianKeys.all, 'mine'] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<Guardian>('/guardians/mine', { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useMyGuardian() {
  return useQuery(myGuardianQueryOptions());
}

/** `PATCH /guardians/mine` — the contact numbers fee reminders actually
 * dial (`UpdateOwnGuardianDto`). Invalidates only the `'mine'` key: a
 * PARENT never holds `GET /guardians`/`GET /guardians/:id` (both are
 * staff-only), so there is no list or detail-by-id cache entry for this
 * caller's own record to keep in sync. */
export function useUpdateMyGuardian() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateOwnGuardianInput) => {
      const res = await apiClient.patch<Guardian>('/guardians/mine', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...guardianKeys.all, 'mine'] });
    },
  });
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

/** [8.11.4]'s Information tab edit action, and the Linked Students tab's
 * add/remove-a-student editor (`student_ids` replaces the guardian's full
 * link set — see `GuardianService.update`). Invalidates both the detail
 * (every field the Information tab shows, plus the Linked Students list
 * once `student_ids` changes) and every list variant, same reasoning as
 * `students.ts`'s `useUpdateStudent`: a changed name/phone/relationship
 * is also a list-column value. */
export function useUpdateGuardian(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateGuardianInput) => {
      const res = await apiClient.patch<Guardian>(`/guardians/${id}`, input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: guardianKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: guardianKeys.lists() });
    },
  });
}

/** Mirrors `students.ts`'s `useDeleteStudent` — `Guardian.deleted_at` soft
 * delete (`GuardianService.remove`). */
export function useDeleteGuardian() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/guardians/${id}`);
    },
    retry: shouldRetryQuery,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: guardianKeys.lists() });
      queryClient.removeQueries({ queryKey: guardianKeys.detail(id) });
    },
  });
}
