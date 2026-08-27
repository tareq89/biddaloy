import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type Student = components['schemas']['Student'];
export type CreateStudentInput = components['schemas']['CreateStudentDto'];
export type UpdateStudentInput = components['schemas']['UpdateStudentDto'];
export type PreferredCommunication = Student['preferred_communication'];
export type EnrollmentStatus = Student['enrollment_status'];

/** Allowlisted server-side — `students.controller.ts`'s `QueryStudentDto`
 * rejects anything else with a 400 (`roll_number` deliberately excluded
 * there: it's only unique per class section, so a tenant-wide sort by it
 * produces a confusing, repeating sequence). */
export type StudentSortField = 'full_name' | 'registration_number' | 'created_at';

export interface StudentListFilters {
  /** Matches by `full_name` or `roll_number` — see `students.controller.ts`'s
   * `QueryStudentDto`. Student has no `phone` column of its own (that
   * lives on `Guardian`), so this can't match on phone. */
  search?: string;
  class_id?: string;
  section_id?: string;
  enrollment_status?: string;
  sort?: StudentSortField;
  order?: 'asc' | 'desc';
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
export const studentKeys = createEntityKeys<StudentListFilters & { mine?: boolean }>('students');

/** Shared with a route's `loader` (`context.queryClient.ensureQueryData
 * (studentsQueryOptions(filters))`), not just `useStudents` below — a
 * loader can't call a hook, but it can call the same `queryOptions()`
 * object, which is what lets [8.9.1]'s hover-intent preload warm the
 * TanStack Query cache, not just fetch the route's JS chunk. */
export function studentsQueryOptions(filters: StudentListFilters = {}) {
  return queryOptions({
    queryKey: studentKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedStudents>('/students', { params: filters, signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

/**
 * `enabled` exists for the search pickers: with no search term there is
 * nothing to pick from, so firing the request on mount (and again after
 * every selection clears the box) only spends a round trip on a list
 * nobody sees.
 */
export function useStudents(filters: StudentListFilters = {}, { enabled = true } = {}) {
  return useQuery({ ...studentsQueryOptions(filters), enabled });
}

/**
 * [5.1]'s `GET /students/mine` — the students the calling PARENT or
 * STUDENT is linked to. The family portal's discovery route: without it a
 * parent has no way to learn their own children's ids, and every other
 * family-facing endpoint is keyed by one.
 *
 * Deliberately a plain `Student[]`, not the `{ data, total, ... }`
 * envelope `useStudents` unwraps — the server returns a bare array here
 * (`students.controller.ts`'s `findMyStudents`), since a family's linked
 * set is small enough that paginating it would be ceremony.
 *
 * Keyed as `studentKeys.list({ mine: true })` rather than a key factory of
 * its own, so `invalidateQueries({ queryKey: studentKeys.lists() })` —
 * what every student mutation already fires — refetches this too.
 *
 * Note for callers: `class_section` and `class_section.class` are loaded,
 * `guardians` deliberately is **not** (`family-access.service.ts`) — a
 * parent shouldn't be handed the other guardians' contact details as a
 * side effect of listing their own children. Reading `.guardians` here
 * type-checks (it's on the shared `Student` type) and is empty at runtime.
 */
export function myStudentsQueryOptions() {
  return queryOptions({
    queryKey: studentKeys.list({ mine: true }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<Student[]>('/students/mine', { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useMyStudents() {
  return useQuery(myStudentsQueryOptions());
}

/** Split out from `useStudent` so an imperative caller (e.g. a CSV export
 * building rows for students spread across pages) can `queryClient
 * .ensureQueryData(studentQueryOptions(id))` outside render — a hook can't
 * be called from a click handler, but this object can. */
export function studentQueryOptions(id: string) {
  return queryOptions({
    queryKey: studentKeys.detail(id),
    queryFn: async () => {
      const res = await apiClient.get<Student>(`/students/${id}`);
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

/** [8.10.5]'s Record Payment wizard doesn't have a student id yet on its
 * deep-link-less path — `id: undefined` disables the query rather than
 * every such caller passing a placeholder id to satisfy a `string`-only
 * signature. `studentQueryOptions` itself stays `string`-only: its other
 * caller (the CSV export's `ensureQueryData`) always has a real id. */
export function useStudent(id: string | undefined) {
  return useQuery({ ...studentQueryOptions(id ?? ''), enabled: id !== undefined });
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

/** [8.10.3]'s Edit Student form — the general-purpose counterpart to
 * `useUpdateStudentPreferredCommunication`/`useUpdateStudentEnrollmentStatus`
 * above. Not optimistic, same reasoning as `useUpdateStudentEnrollmentStatus`:
 * a full edit is a deliberate, form-submit action a staff member is already
 * waiting on, not a background preference flip. Invalidates both the detail
 * (fields shown on the student page) and every list variant (name, roll
 * number and class/section — all list-column values — can all change here). */
export function useUpdateStudent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateStudentInput) => {
      const res = await apiClient.patch<Student>(`/students/${id}`, input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studentKeys.detail(id) });
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
 *
 * `scope: { id: `student-preferred-communication-${id}` }` serializes
 * calls for the *same* student — without it, two updates fired close
 * together (a double-click, or two dropdown changes before the first
 * settles) would each snapshot in `onMutate` before either resolves,
 * and whichever rejects last would roll back over the other's still-
 * pending optimistic write, or even over its own already-applied
 * success. Scoping by `id` only serializes same-student calls; two
 * different students' updates still run concurrently, which is correct
 * — they don't share any cache entry to race over.
 */
export function useUpdateStudentPreferredCommunication(id: string) {
  const queryClient = useQueryClient();
  return useMutation<Student, Error, PreferredCommunication, PreferredCommunicationContext>({
    scope: { id: `student-preferred-communication-${id}` },
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

/** [8.10.2]'s Transfer/Change Status action. Deliberately **not**
 * optimistic like `useUpdateStudentPreferredCommunication` above —
 * transferring or graduating a student is a consequential change a staff
 * member is actively confirming through a dialog, not a background
 * preference flip, so there's no UX cost to waiting for the server the
 * way there would be for a dropdown. */
export function useUpdateStudentEnrollmentStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enrollment_status: EnrollmentStatus) => {
      const res = await apiClient.patch<Student>(`/students/${id}`, { enrollment_status });
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studentKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: studentKeys.lists() });
    },
  });
}

/** [8.10.2]'s Delete action — `Student.deleted_at` soft delete
 * (`students.service.ts`'s `remove`), same reasoning as
 * `useCreateStudent`: a removed student can affect any cached list
 * variant, so every list, not just one filter combination, is
 * invalidated. */
export function useDeleteStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/students/${id}`);
    },
    retry: shouldRetryQuery,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: studentKeys.lists() });
      queryClient.removeQueries({ queryKey: studentKeys.detail(id) });
    },
  });
}
