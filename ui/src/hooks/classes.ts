import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type Class = components['schemas']['Class'];
export type ClassSection = components['schemas']['ClassSection'];

/** `GET /api/v1/classes`'s 200 body untyped in `schema.d.ts` — same gap
 * `students.ts`'s `PaginatedStudents` documents for the sibling endpoint —
 * so hand-typed against the `{ data, total, page, limit, totalPages }`
 * envelope every list endpoint actually returns. */
export interface PaginatedClasses {
  data: Class[];
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
  return queryOptions({
    queryKey: classKeys.list(params),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedClasses>('/classes', { params, signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useClasses(filters: ClassListFilters = {}) {
  return useQuery(classesQueryOptions(filters));
}

/** `GET /classes/:classId/sections` returns a plain array, not the
 * `{ data, total, ... }` list envelope — see `classes.controller.ts`'s
 * `SectionService.findAllByClass`, which has no pagination of its own
 * because a class's section count is always small (a handful of letters,
 * never hundreds of rows). */
export function classSectionsQueryOptions(classId: string | undefined) {
  return queryOptions({
    queryKey: [...classKeys.all, 'sections', classId] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ClassSection[]>(`/classes/${classId}/sections`, { signal });
      return res.data;
    },
    enabled: classId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useClassSections(classId: string | undefined) {
  return useQuery(classSectionsQueryOptions(classId));
}
