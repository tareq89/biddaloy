import { hasTenantScope, Permission, UserRole, type SyllabusTopicStatus } from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { useActiveRole, useCurrentUserId } from './auth-state';
import { useHasPermission } from './permissions';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';
import { teachersQueryOptions, useTeacherAssignments } from './teachers';

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
  /** Only present when both class and subject filters are set (66.2.07, D31). */
  sections_taught?: number;
  sections_planned?: number;
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

/**
 * Client mirror of the server's `assertCanWrite` (syllabus.service.ts): SYLLABUS_MANAGE, and a
 * TEACHER only for a class x subject they hold a SUBJECT_TEACHER row for. Tenant-scope roles
 * (admins) write everywhere. False while the teacher's assignments load. Display only; the
 * server (403 SYLLABUS_OUT_OF_SCOPE) is the real boundary.
 */
export function useCanWriteSyllabus(classId: string, subjectId: string): boolean {
  const canManage = useHasPermission(Permission.SYLLABUS_MANAGE);
  const role = useActiveRole();
  const userId = useCurrentUserId();
  const isTeacher = role === UserRole.TEACHER;
  const teacherQuery = useQuery({
    ...teachersQueryOptions({ user_id: userId ?? undefined, limit: 1 }),
    enabled: isTeacher && userId !== null,
  });
  const assignments = useTeacherAssignments(teacherQuery.data?.data[0]?.id);
  if (!canManage) return false;
  if (hasTenantScope(role)) return true;
  if (!isTeacher) return false;
  return (assignments.data ?? []).some(
    (a) =>
      a.assignment_type === 'SUBJECT_TEACHER' &&
      a.class_id === classId &&
      a.subject_id === subjectId,
  );
}
