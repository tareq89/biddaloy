import type { SyllabusTopicStatus } from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// TODO(schema): swap for components['schemas'][...] once schema.d.ts is
// regenerated for 22.3.4 — same reasoning as ui/src/hooks/homework.ts.
export interface SyllabusTopic {
  id: string;
  class_id: string;
  subject_id: string;
  subject_name_en: string | null;
  subject_name_bn: string | null;
  name: string;
  description: string | null;
  sequence: number;
  status: SyllabusTopicStatus;
}

export interface SyllabusTopicListFilters {
  class_id?: string;
  subject_id?: string;
}

export interface CreateSyllabusTopicInput {
  class_id: string;
  subject_id: string;
  name: string;
  description?: string | null;
  sequence: number;
  status?: SyllabusTopicStatus;
}

export interface UpdateSyllabusTopicInput {
  name?: string;
  description?: string | null;
  sequence?: number;
  status?: SyllabusTopicStatus;
}

export interface ReorderSyllabusTopicItem {
  id: string;
  sequence: number;
}

export const syllabusTopicKeys = createEntityKeys<SyllabusTopicListFilters>('syllabus-topics');

export function syllabusTopicListQueryOptions(filters: SyllabusTopicListFilters = {}) {
  const queryKey = syllabusTopicKeys.list(filters);
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<SyllabusTopic[]>('/syllabus-topics', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useSyllabusTopicList(
  filters: SyllabusTopicListFilters = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({ ...syllabusTopicListQueryOptions(filters), enabled: options.enabled ?? true });
}

export function useCreateSyllabusTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSyllabusTopicInput) => {
      const res = await apiClient.post<SyllabusTopic>('/syllabus-topics', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: syllabusTopicKeys.lists() });
    },
  });
}

export function useUpdateSyllabusTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateSyllabusTopicInput }) => {
      const res = await apiClient.patch<SyllabusTopic>(`/syllabus-topics/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: syllabusTopicKeys.lists() });
    },
  });
}

export function useDeleteSyllabusTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/syllabus-topics/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: syllabusTopicKeys.lists() });
    },
  });
}

/**
 * Bulk sequence update — `PATCH /syllabus-topics/reorder` (not per-row
 * `PATCH /syllabus-topics/:id`), so a keyboard up/down move is one request
 * for the two swapped rows, not N requests.
 */
export function useReorderSyllabusTopics() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: ReorderSyllabusTopicItem[]) => {
      const res = await apiClient.patch<SyllabusTopic[]>('/syllabus-topics/reorder', { items });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: syllabusTopicKeys.lists() });
    },
  });
}
