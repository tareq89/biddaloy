import type { TeacherDesignation } from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import { offlineCachedQueryFn } from '../api/offline-cache';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type Class = components['schemas']['Class'];
export type ClassSection = components['schemas']['ClassSection'];
export type CreateClassInput = components['schemas']['CreateClassDto'];
export type UpdateClassInput = components['schemas']['UpdateClassDto'];
export type CreateSectionInput = components['schemas']['CreateSectionDto'];
export type UpdateSectionInput = components['schemas']['UpdateSectionDto'];

/** [8.11.2] — `SectionService.findAll`'s per-section `enrolled_count`,
 * mirroring `classes.service.ts`'s own hand-typed `ClassSectionWithCount`
 * (same "no `@ApiResponse` decoration, so nothing for `schema.d.ts` to
 * generate" gap `AcademicYearStats` (8.11.1) documents). The classes
 * list's inline expansion panel reads this to show each section's
 * enrolled count without an extra request per section. */
export type ClassSectionWithCount = ClassSection & { enrolled_count: number };

/** [8.11.2] — `SectionService.findTeachers`'s response shape, mirrored
 * from `classes.service.ts`'s own `ClassTeacher`. Read-only: teacher CRUD
 * is #177, this only carries what the class detail page's Teachers tab
 * needs. */
export interface ClassTeacher {
  id: string;
  employee_id: string;
  full_name: string;
  designations: TeacherDesignation[];
  section_names: string[];
}

/** [8.11.2] — `ClassService.findAll`'s per-class `section_count`/
 * `student_count`, mirroring `classes.service.ts`'s own hand-typed
 * `ClassWithCounts`. Computed server-side (two grouped queries) so the
 * classes list's Sections/Students columns render straight off the list
 * payload — no more per-row `useClassSections(classId)` mount just to sum
 * `enrolled_count` client-side. Note `sections` itself is *not* loaded on
 * this endpoint (unlike `GET /classes/:id`) — use `section_count`/
 * `student_count` instead of `sections.length`. */
export type ClassWithCounts = Class & { section_count: number; student_count: number };

/** `GET /api/v1/classes`'s 200 body untyped in `schema.d.ts` — same gap
 * `students.ts`'s `PaginatedStudents` documents for the sibling endpoint —
 * so hand-typed against the `{ data, total, page, limit, totalPages }`
 * envelope every list endpoint actually returns. */
export interface PaginatedClasses {
  data: ClassWithCounts[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ClassListFilters {
  academic_year_id?: string;
  page?: number;
  limit?: number;
}

export const classKeys = createEntityKeys<ClassListFilters>('classes');

/** Bare `useClasses()` (a filter dropdown's "All classes" list, e.g.
 * `dues.tsx`, `students/index.tsx`) never sets `page`/`limit` — a school's
 * whole class list comfortably fits one page at this generous default, so
 * those callers don't need to wire pagination through a `<select>`.
 * `academic_year_id`-scoped callers (the Academic Year detail page's
 * Classes tab) pass their own `page`/`limit` to page through a year that
 * genuinely has more classes than the default ceiling. */
const CLASS_FILTER_LIMIT = 100;

export function classesQueryOptions(filters: ClassListFilters = {}) {
  const params = { limit: CLASS_FILTER_LIMIT, ...filters };
  const queryKey = classKeys.list(params);
  return queryOptions({
    queryKey,
    // [8.12.3] offline read cache — see `studentsQueryOptions`.
    queryFn: offlineCachedQueryFn<PaginatedClasses>({
      entity: 'classes',
      queryKey,
      fetch: (signal) => apiClient.get<PaginatedClasses>('/classes', { params, signal }),
    }),
    retry: shouldRetryQuery,
  });
}

export function useClasses(filters: ClassListFilters = {}) {
  return useQuery(classesQueryOptions(filters));
}

export function classQueryOptions(id: string) {
  return queryOptions({
    queryKey: classKeys.detail(id),
    queryFn: async () => {
      const res = await apiClient.get<Class>(`/classes/${id}`);
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useClass(id: string | undefined) {
  return useQuery({ ...classQueryOptions(id ?? ''), enabled: id !== undefined });
}

/** Own key branch (`[...classKeys.all, 'sections', classId]`), not
 * `classKeys.detail(classId)` — a class's sections are a nested
 * collection with their own CRUD lifecycle, not a field of the class
 * itself, so they need to be invalidatable independently of the class
 * detail query. Exported (not just used internally) so section mutations
 * below can target the same key without re-deriving it. */
export function classSectionsKey(classId: string | undefined) {
  return [...classKeys.all, 'sections', classId] as const;
}

/** `GET /classes/:classId/sections` returns a plain array, not the
 * `{ data, total, ... }` list envelope — see `classes.controller.ts`'s
 * `SectionService.findAllByClass`, which has no pagination of its own
 * because a class's section count is always small (a handful of letters,
 * never hundreds of rows). Response now carries `enrolled_count` per
 * section (see `ClassSectionWithCount` above) — `SectionService.findAll`
 * already returns it, so this is a type-only change, not a new request. */
export function classSectionsQueryOptions(classId: string | undefined) {
  const queryKey = classSectionsKey(classId);
  return queryOptions({
    queryKey,
    // [8.12.3] offline read cache — see `studentsQueryOptions`.
    queryFn: offlineCachedQueryFn<ClassSectionWithCount[]>({
      entity: 'class-sections',
      queryKey,
      fetch: (signal) =>
        apiClient.get<ClassSectionWithCount[]>(`/classes/${classId}/sections`, { signal }),
    }),
    enabled: classId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useClassSections(classId: string | undefined) {
  return useQuery(classSectionsQueryOptions(classId));
}

/** [8.11.2] — class detail page's Teachers tab. Read-only (teacher CRUD is
 * #177), so no mutations alongside it. */
export function classTeachersQueryOptions(classId: string | undefined) {
  return queryOptions({
    queryKey: [...classKeys.all, 'teachers', classId] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ClassTeacher[]>(`/classes/${classId}/teachers`, { signal });
      return res.data;
    },
    enabled: classId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useClassTeachers(classId: string | undefined) {
  return useQuery(classTeachersQueryOptions(classId));
}

export function useCreateClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateClassInput) => {
      const res = await apiClient.post<Class>('/classes', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: classKeys.lists() });
    },
  });
}

export function useUpdateClass(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateClassInput) => {
      const res = await apiClient.patch<Class>(`/classes/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: classKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: classKeys.lists() });
    },
  });
}

export function useDeleteClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/classes/${id}`);
    },
    retry: shouldRetryQuery,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: classKeys.lists() });
      queryClient.removeQueries({ queryKey: classKeys.detail(id) });
    },
  });
}

/** Every section mutation invalidates both this class's sections list
 * *and* `classKeys.lists()` — the classes list's own row shows a section
 * count (see `classes/index.tsx`), so a section create/delete has to
 * refresh that row too, not just the expanded panel that triggered it. */
export function useCreateSection(classId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSectionInput) => {
      const res = await apiClient.post<ClassSection>(`/classes/${classId}/sections`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: classSectionsKey(classId) });
      void queryClient.invalidateQueries({ queryKey: classKeys.lists() });
    },
  });
}

export function useUpdateSection(classId: string, sectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSectionInput) => {
      const res = await apiClient.patch<ClassSection>(
        `/classes/${classId}/sections/${sectionId}`,
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: classSectionsKey(classId) });
      void queryClient.invalidateQueries({ queryKey: classKeys.lists() });
    },
  });
}

export function useDeleteSection(classId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sectionId: string) => {
      await apiClient.delete(`/classes/${classId}/sections/${sectionId}`);
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: classSectionsKey(classId) });
      void queryClient.invalidateQueries({ queryKey: classKeys.lists() });
    },
  });
}
