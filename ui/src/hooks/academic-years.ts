import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useApprovedMutation } from './approval';
import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type AcademicYear = components['schemas']['AcademicYear'];
export type CreateAcademicYearInput = components['schemas']['CreateAcademicYearDto'];
export type UpdateAcademicYearInput = components['schemas']['UpdateAcademicYearDto'];

/** `GET /academic-years/:id/stats`'s 200 body untyped in `schema.d.ts` —
 * the controller never attached an `@ApiResponse` type, same gap
 * `students.ts`'s `PaginatedStudents` documents for a sibling endpoint —
 * so hand-typed against `academic-year.service.ts`'s `AcademicYearStats`. */
export interface AcademicYearStats {
  classes_count: number;
  students_count: number;
  fee_structures_count: number;
}

/** `GET /academic-years`'s 200 body — same untyped-list gap as above. */
export interface PaginatedAcademicYears {
  data: AcademicYear[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AcademicYearListFilters {
  page?: number;
  limit?: number;
}

export const academicYearKeys = createEntityKeys<AcademicYearListFilters>('academic-years');

export function academicYearsQueryOptions(filters: AcademicYearListFilters = {}) {
  return queryOptions({
    queryKey: academicYearKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedAcademicYears>('/academic-years', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
    // [8.14.6] Filter/page/sort changes keep the previous page's rows on
    // screen (and `isFetching` true) instead of the whole table collapsing
    // to one "Loading…" row height. v5 dropped `keepPreviousData: true`;
    // this is its replacement.
    placeholderData: keepPreviousData,
  });
}

export function useAcademicYears(filters: AcademicYearListFilters = {}) {
  return useQuery(academicYearsQueryOptions(filters));
}

export function academicYearQueryOptions(id: string) {
  return queryOptions({
    queryKey: academicYearKeys.detail(id),
    queryFn: async () => {
      const res = await apiClient.get<AcademicYear>(`/academic-years/${id}`);
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useAcademicYear(id: string | undefined) {
  return useQuery({ ...academicYearQueryOptions(id ?? ''), enabled: id !== undefined });
}

export function academicYearStatsQueryOptions(id: string) {
  return queryOptions({
    queryKey: [...academicYearKeys.detail(id), 'stats'] as const,
    queryFn: async () => {
      const res = await apiClient.get<AcademicYearStats>(`/academic-years/${id}/stats`);
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useAcademicYearStats(id: string | undefined) {
  return useQuery({ ...academicYearStatsQueryOptions(id ?? ''), enabled: id !== undefined });
}

export function useCreateAcademicYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAcademicYearInput) => {
      const res = await apiClient.post<AcademicYear>('/academic-years', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: academicYearKeys.lists() });
    },
  });
}

export function useUpdateAcademicYear(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateAcademicYearInput) => {
      const res = await apiClient.patch<AcademicYear>(`/academic-years/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: academicYearKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: academicYearKeys.lists() });
    },
  });
}

export function useDeleteAcademicYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/academic-years/${id}`);
    },
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: academicYearKeys.lists() });
      queryClient.removeQueries({ queryKey: academicYearKeys.detail(id) });
    },
  });
}

/** `POST /academic-years/:id/set-current` unsets every other year for the
 * tenant (`academic-year.service.ts`'s `setCurrent`) — a side effect wide
 * enough that every list/detail entry, not just the target year, is
 * invalidated rather than patched in place. */
export function useSetCurrentAcademicYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<AcademicYear>(`/academic-years/${id}/set-current`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: academicYearKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: academicYearKeys.details() });
    },
  });
}

// ---- [69.4.02] Year rollover, close / reopen, readiness ----------------------------------

export type YearRolloverInput = components['schemas']['YearRolloverDto'];
export type YearClosePreview = components['schemas']['YearClosePreviewDto'];
export type YearReadiness = components['schemas']['YearReadinessDto'];

/** One copied block: rows made now, rows already there, rows left out (with the reason). */
export interface YearRolloverBlockResult {
  created: number;
  existing: number;
  skipped: { name: string; reason: string }[];
}

/** `GET /academic-years/:id/next/preview` and `POST /academic-years/:id/next` answer with this
 * shape (`year-rollover.service.ts`'s `YearRolloverResult`); the controllers carry no
 * `@ApiResponse` type, so `schema.d.ts` has `Record<string, never>` — hand-typed here, same gap
 * as `AcademicYearStats` above. `target_year_id` is null in a preview of a year not yet made. */
export interface YearRolloverResult {
  target_year_id: string | null;
  classes?: YearRolloverBlockResult;
  sections?: YearRolloverBlockResult;
  class_subjects?: YearRolloverBlockResult;
  teacher_assignments?: YearRolloverBlockResult;
  fee_structures?: YearRolloverBlockResult;
  grading_scales?: YearRolloverBlockResult;
  terms?: YearRolloverBlockResult;
  skipped_staff: { teacher_name: string; section: string; subject: string }[];
}

/** The wire query is `include=a,b`; omitted means every block (server default). */
function rolloverParams(input: YearRolloverInput) {
  return {
    name: input.name,
    start_date: input.start_date,
    end_date: input.end_date,
    ...(input.include ? { include: input.include.join(',') } : {}),
  };
}

export function yearRolloverPreviewQueryOptions(
  yearId: string,
  input: YearRolloverInput | undefined,
) {
  return queryOptions({
    queryKey: [...academicYearKeys.detail(yearId), 'rollover-preview', input] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<YearRolloverResult>(
        `/academic-years/${yearId}/next/preview`,
        { params: rolloverParams(input as YearRolloverInput), signal },
      );
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

/** Dry run, writes nothing. Waits for `input` and for at least one block to be chosen. */
export function useYearRolloverPreview(
  yearId: string | undefined,
  input: YearRolloverInput | undefined,
) {
  return useQuery({
    ...yearRolloverPreviewQueryOptions(yearId ?? '', input),
    enabled: yearId !== undefined && input !== undefined && input.include?.length !== 0,
  });
}

/** `POST /academic-years/:id/next` — makes the year and copies the chosen blocks in one
 * transaction. Carries an `Idempotency-Key` ([2642]) and is never auto-retried. */
export function useCreateNextYear(yearId: string) {
  const queryClient = useQueryClient();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: YearRolloverInput) => {
      const res = await apiClient.post<YearRolloverResult>(
        `/academic-years/${yearId}/next`,
        input,
        { headers: { 'Idempotency-Key': keyFor(input) } },
      );
      return res.data;
    },
    onSuccess: () => {
      rotate();
      void queryClient.invalidateQueries({ queryKey: academicYearKeys.all });
    },
    retry: false,
  });
}

export function yearClosePreviewQueryOptions(id: string) {
  return queryOptions({
    queryKey: [...academicYearKeys.detail(id), 'close-preview'] as const,
    queryFn: async () => {
      const res = await apiClient.get<YearClosePreview>(`/academic-years/${id}/close-preview`);
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

/** Pass `enabled: false` until the dialog opens. */
export function useYearClosePreview(id: string | undefined, enabled = true) {
  return useQuery({
    ...yearClosePreviewQueryOptions(id ?? ''),
    enabled: enabled && id !== undefined,
  });
}

export function yearReadinessQueryOptions(id: string) {
  return queryOptions({
    queryKey: [...academicYearKeys.detail(id), 'readiness'] as const,
    queryFn: async () => {
      const res = await apiClient.get<YearReadiness>(`/academic-years/${id}/readiness`);
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useYearReadiness(id: string | undefined, enabled = true) {
  return useQuery({
    ...yearReadinessQueryOptions(id ?? ''),
    enabled: enabled && id !== undefined,
  });
}

/** Close and reopen both need a step-up approval. A closed/reopened year changes what every
 * year-scoped screen may write, so every year entry is invalidated, not patched. */
function useYearStateMutation(action: 'close' | 'reopen') {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    async (id: string, options: { headers?: Record<string, string> }) => {
      const res = await apiClient.post<AcademicYear>(
        `/academic-years/${id}/${action}`,
        undefined,
        options.headers ? { headers: options.headers } : undefined,
      );
      return res.data;
    },
    {
      approvalScope: `academic_year.${action}`,
      retry: false,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: academicYearKeys.all });
      },
    },
  );
}

export const useCloseYear = () => useYearStateMutation('close');
export const useReopenYear = () => useYearStateMutation('reopen');
