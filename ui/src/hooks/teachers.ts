import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type Teacher = components['schemas']['TeacherResponseDto'];
export type CreateTeacherInput = components['schemas']['CreateTeacherDto'];
export type UpdateTeacherInput = components['schemas']['UpdateTeacherDto'];
export type PaginatedTeachers = components['schemas']['TeacherListResponseDto'];

export interface TeacherListFilters {
  search?: string;
  /** Server-side exact filter ([8.11.8]) — "does this member already have
   * a teacher profile?" without paging the whole list client-side. */
  user_id?: string;
  page?: number;
  limit?: number;
}

export const teacherKeys = createEntityKeys<TeacherListFilters>('teachers');

// ponytail: same "no wire pagination needed" reasoning as `subjects.ts`'s
// `SUBJECT_FILTER_LIMIT` — a school's whole teacher list comfortably fits
// one page, so a dropdown/lookup caller can default to a generous limit
// rather than silently missing a teacher past the server's own default of
// 10. Ceiling is 100 teachers; page explicitly if a caller ever needs more.
const TEACHER_FILTER_LIMIT = 100;

/** [8.11.8]'s promote-teacher flow — mirrors `guardians.ts`'s shape. */
export function teachersQueryOptions(filters: TeacherListFilters) {
  const params = { limit: TEACHER_FILTER_LIMIT, ...filters };
  return queryOptions({
    queryKey: teacherKeys.list(params),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedTeachers>('/teachers', {
        params,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useTeachers(filters: TeacherListFilters) {
  return useQuery(teachersQueryOptions(filters));
}

/** [29.0] `UserService.getTeacherAssignments`'s response shape, mirrored
 * from `users.service.ts`'s own `SectionTeacherAssignment` re-export (same
 * shape `classes.ts`'s `SectionTeacherAssignment` documents — no
 * `@ApiResponse` decoration on this list endpoint either). */
export interface TeacherAssignment {
  id: string;
  teacher_id: string;
  employee_id: string;
  full_name: string;
  section_id: string;
  section_name: string;
  subject_id: string | null;
  subject_name: string | null;
}

export function teacherAssignmentsQueryOptions(teacherId: string | undefined) {
  return queryOptions({
    queryKey: [...teacherKeys.all, 'assignments', teacherId] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<TeacherAssignment[]>(`/teachers/${teacherId}/assignments`, {
        signal,
      });
      return res.data;
    },
    enabled: teacherId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useTeacherAssignments(teacherId: string | undefined) {
  return useQuery(teacherAssignmentsQueryOptions(teacherId));
}

/** "Promote an existing tenant member to a teacher profile" — the server's
 * own framing of `POST /teachers`. 400 = user isn't a member of this
 * tenant; 409 = `employee_id` already exists (globally unique, across
 * every school); 404 = unknown `assigned_section_ids`. */
export function useCreateTeacher() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTeacherInput) => {
      const res = await apiClient.post<Teacher>('/teachers', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: teacherKeys.lists() });
    },
  });
}

/** `assigned_section_ids` **replaces** the teacher's whole set — a caller
 * editing one section must resend every id it wants kept. */
export function useUpdateTeacher(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateTeacherInput) => {
      const res = await apiClient.patch<Teacher>(`/teachers/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: teacherKeys.lists() });
    },
  });
}
