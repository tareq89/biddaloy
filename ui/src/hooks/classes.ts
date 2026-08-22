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

export const classKeys = createEntityKeys<{ limit?: number }>('classes');

/** A class list backs a filter dropdown ("All classes"), not a paginated
 * table — a school's whole class list comfortably fits one page at a
 * generous limit, so callers don't need to wire pagination through a
 * `<select>`. `limit: 100` is a deliberate ceiling, not a real page size. */
const CLASS_FILTER_LIMIT = 100;

export function classesQueryOptions() {
  return queryOptions({
    queryKey: classKeys.list({ limit: CLASS_FILTER_LIMIT }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedClasses>('/classes', {
        params: { limit: CLASS_FILTER_LIMIT },
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useClasses() {
  return useQuery(classesQueryOptions());
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
