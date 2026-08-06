import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type Student = components['schemas']['Student'];
export type CreateStudentInput = components['schemas']['CreateStudentDto'];
export type PreferredCommunication = Student['preferred_communication'];

export interface StudentListFilters {
  class_id?: string;
  section_id?: string;
  enrollment_status?: string;
  page?: number;
  limit?: number;
}

/** `GET /api/v1/students`'s 200 body is untyped in `schema.d.ts` — the
 * controller never attached an `@ApiResponse` type (same gap [8.4.2]'s
 * MSW handlers document for the same endpoint) — so this is hand-typed
 * against the `{ data, total, page, limit, totalPages }` envelope every
 * list endpoint actually returns. */
export interface PaginatedStudents {
  data: Student[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * The reference query-key instance every other entity's keys should
 * mirror — see `./query-keys.ts`'s own comment on the hierarchical shape
 * and why it matters for invalidation precision.
 */
export const studentKeys = createEntityKeys<StudentListFilters>('students');

export function useStudents(filters: StudentListFilters = {}) {
  return useQuery({
    queryKey: studentKeys.list(filters),
    queryFn: async () => {
      const res = await apiClient.get<PaginatedStudents>('/students', { params: filters });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useStudent(id: string) {
  return useQuery({
    queryKey: studentKeys.detail(id),
    queryFn: async () => {
      const res = await apiClient.get<Student>(`/students/${id}`);
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

/**
 * The reference mutation for the invalidation pattern: on success,
 * invalidate `studentKeys.lists()` — every list variant (any filter/page
 * combination), not just whichever one the caller happened to be
 * looking at. A new student can affect a list filtered by a different
 * class or section too (one whose filter the new student now matches),
 * so scoping this to a single `studentKeys.list(currentFilters)` would
 * leave those other cached variants stale.
 */
export function useCreateStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateStudentInput) => {
      const res = await apiClient.post<Student>('/students', input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studentKeys.lists() });
    },
  });
}

interface PreferredCommunicationContext {
  previousStudent: Student | undefined;
}

/**
 * The reference **optimistic** mutation — [8.4.4]'s low-stakes
 * counterpart to `payments.ts`'s `useCreatePayment`. A guardian's
 * preferred contact channel has none of a payment's stakes: worst case
 * on a rollback, the UI briefly showed the wrong dropdown value. That's
 * exactly the bar for "safe to show before the server confirms" — this
 * hook is not itself financial, has no `onMutate` on a guarded endpoint,
 * and so the `no-optimistic-financial-mutation` ESLint rule leaves it
 * alone.
 *
 * The three-part pattern every legitimate optimistic mutation follows:
 *   - `onMutate`: cancel any in-flight refetch for this query (so it
 *     can't overwrite the optimistic value with stale in-flight data),
 *     snapshot the current cache value for rollback, then write the
 *     optimistic value.
 *   - `onError`: roll back to the snapshot — the UI must return to
 *     exactly the state it was in before the optimistic write, not to
 *     some other "reset" value.
 *   - `onSettled`: invalidate regardless of outcome, so the cache
 *     reconciles with the server's actual state even after a rollback
 *     (a `TRANSFERRED` race with another client, say).
 */
export function useUpdateStudentPreferredCommunication(id: string) {
  const queryClient = useQueryClient();
  return useMutation<Student, Error, PreferredCommunication, PreferredCommunicationContext>({
    mutationFn: async (preferred_communication) => {
      const res = await apiClient.patch<Student>(`/students/${id}`, { preferred_communication });
      return res.data;
    },
    retry: shouldRetryQuery,
    onMutate: async (preferred_communication) => {
      await queryClient.cancelQueries({ queryKey: studentKeys.detail(id) });
      const previousStudent = queryClient.getQueryData<Student>(studentKeys.detail(id));
      if (previousStudent) {
        queryClient.setQueryData<Student>(studentKeys.detail(id), {
          ...previousStudent,
          preferred_communication,
        });
      }
      return { previousStudent };
    },
    onError: (_error, _preferred_communication, context) => {
      if (context?.previousStudent) {
        queryClient.setQueryData(studentKeys.detail(id), context.previousStudent);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: studentKeys.detail(id) });
    },
  });
}
