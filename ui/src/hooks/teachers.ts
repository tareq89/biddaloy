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

/** [8.11.8]'s promote-teacher flow — mirrors `guardians.ts`'s shape. */
export function teachersQueryOptions(filters: TeacherListFilters) {
  return queryOptions({
    queryKey: teacherKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedTeachers>('/teachers', {
        params: filters,
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
