import type { HomeworkAssignmentStatus, HomeworkGradingMode } from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// TODO(schema): swap for components['schemas'][...] once schema.d.ts is regenerated for 22.3.x
export interface Homework {
  id: string;
  subject_id: string;
  class_id: string;
  title: string;
  description: string | null;
  grading_mode: HomeworkGradingMode;
  attachments: unknown[];
  created_at: string;
}

export interface HomeworkAssignment {
  id: string;
  homework_id: string;
  section_id: string | null;
  student_id: string | null;
  assigned_date: string;
  due_date: string;
  status: HomeworkAssignmentStatus;
}

export interface HomeworkListFilters {
  class_id?: string;
  section_id?: string;
  subject_id?: string;
  status?: HomeworkAssignmentStatus;
}

export interface CreateHomeworkInput {
  subject_id: string;
  class_id: string;
  title: string;
  description?: string;
  grading_mode: HomeworkGradingMode;
}

export interface AssignHomeworkInput {
  section_id?: string;
  student_id?: string;
  assigned_date: string;
  due_date: string;
}

export const homeworkKeys = createEntityKeys<HomeworkListFilters>('homework');

export function homeworkListQueryOptions(filters: HomeworkListFilters = {}) {
  const queryKey = homeworkKeys.list(filters);
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<Homework[]>('/homework', { params: filters, signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useHomeworkList(filters: HomeworkListFilters = {}) {
  return useQuery(homeworkListQueryOptions(filters));
}

export function homeworkQueryOptions(id: string) {
  return queryOptions({
    queryKey: homeworkKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<Homework>(`/homework/${id}`, { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useHomework(id: string | undefined) {
  return useQuery({ ...homeworkQueryOptions(id ?? ''), enabled: id !== undefined });
}

export function useCreateHomework() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateHomeworkInput) => {
      const res = await apiClient.post<Homework>('/homework', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: homeworkKeys.lists() });
    },
  });
}

/**
 * The homework id goes in the mutation variables, not the hook argument —
 * `new.tsx` only learns it mid-submit, after `useCreateHomework` resolves.
 * Invalidates the list because its `section_id`/`status` filters join on
 * assignments.
 */
export function useAssignHomework() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      homeworkId,
      input,
    }: {
      homeworkId: string;
      input: AssignHomeworkInput;
    }) => {
      const res = await apiClient.post<HomeworkAssignment>(`/homework/${homeworkId}/assign`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: homeworkKeys.lists() });
    },
  });
}
