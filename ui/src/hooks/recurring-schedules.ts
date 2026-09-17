import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/**
 * [16.7.5] Hand-typed interim client contract for `RecurringSchedule`
 * CRUD. Server ticket #675 (same wave, sibling lane) builds the actual
 * `/fees/schedules` endpoints and their `schema.d.ts` entries in
 * parallel — this file does NOT wait on that merge, per this ticket's
 * plan. Once #675 lands and `schema.d.ts` regenerates with real
 * `RecurringSchedule`/`CreateRecurringScheduleDto`/etc. types, this file
 * should be replaced by `components['schemas'][...]` aliases the same
 * way every other entity hook in this directory does it — the shapes
 * below were written to match the contract documented on issue #679,
 * so that swap should be a type-only diff, not a behavior change.
 */

export type RecurringScheduleRuleMode = 'MONTHLY' | 'WEEKLY';

/** Day-of-month rule: 1-28, or the literal `'LAST'` for "last day of
 * the month" (handles 30/31/Feb without a magic 29-31 number). */
export type MonthlyRuleDay = number | 'LAST';

export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface RecurringScheduleRule {
  mode: RecurringScheduleRuleMode;
  /** Set when `mode === 'MONTHLY'`. */
  day_of_month?: MonthlyRuleDay;
  /** Set when `mode === 'WEEKLY'`. */
  weekdays?: Weekday[];
}

export interface RecurringScheduleAudience {
  class_id?: string | null;
  section_id?: string | null;
  active_only: boolean;
}

export interface RecurringSchedule {
  id: string;
  name: string;
  academic_year_id: string;
  fee_structure_ids: string[];
  audience: RecurringScheduleAudience;
  rule: RecurringScheduleRule;
  due_days_after_period_start: number;
  starts_on: string;
  ends_on: string | null;
  notify_families: boolean;
  is_active: boolean;
  last_run_period: string | null;
  created_at: string;
  updated_at: string;
  /** Only populated on `GET /fees/schedules/:id` (the detail fetch), not
   * on list rows — matches `useStudentFeeSummary`'s `fee_breakdown`
   * precedent for "detail-only nested collection" in this codebase. */
  exclusions?: RecurringScheduleExclusion[];
}

export interface RecurringScheduleExclusion {
  student_id: string;
  student_name: string;
  reason: string | null;
  created_at: string;
}

export interface CreateRecurringScheduleInput {
  name: string;
  academic_year_id: string;
  fee_structure_ids: string[];
  audience: RecurringScheduleAudience;
  rule: RecurringScheduleRule;
  due_days_after_period_start: number;
  starts_on: string;
  ends_on: string | null;
  notify_families: boolean;
}

export type UpdateRecurringScheduleInput = Partial<CreateRecurringScheduleInput> & {
  is_active?: boolean;
};

export interface RecurringSchedulePreviewResult {
  matching_student_count: number;
}

export interface PaginatedRecurringSchedules {
  data: RecurringSchedule[];
  total: number;
  page: number;
  limit: number;
}

export interface RecurringScheduleListFilters {
  academic_year_id?: string;
  is_active?: boolean;
  page?: number;
  limit?: number;
}

/** One student's recurring-schedule coverage — `GET /students/:id/
 * schedules` per issue #679's contract table. */
export interface StudentScheduleCoverage {
  included: RecurringSchedule[];
  excluded: (RecurringSchedule & { exclusion_reason: string | null })[];
}

export const recurringScheduleKeys =
  createEntityKeys<RecurringScheduleListFilters>('recurring-schedules');

export function recurringSchedulesQueryOptions(filters: RecurringScheduleListFilters = {}) {
  return queryOptions({
    queryKey: recurringScheduleKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedRecurringSchedules>('/fees/schedules', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useRecurringSchedules(filters: RecurringScheduleListFilters = {}) {
  return useQuery(recurringSchedulesQueryOptions(filters));
}

export function recurringScheduleQueryOptions(id: string) {
  return queryOptions({
    queryKey: recurringScheduleKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<RecurringSchedule>(`/fees/schedules/${id}`, { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useRecurringSchedule(id: string | undefined) {
  return useQuery({ ...recurringScheduleQueryOptions(id ?? ''), enabled: id !== undefined });
}

export function useCreateRecurringSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRecurringScheduleInput) => {
      const res = await apiClient.post<RecurringSchedule>('/fees/schedules', input);
      return res.data;
    },
    // No retry — POST isn't idempotent, matches useCreateFeeStructure's
    // reasoning (double-submit would create a second schedule that
    // double-bills every matching student going forward).
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recurringScheduleKeys.lists() });
    },
  });
}

export function useUpdateRecurringSchedule(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateRecurringScheduleInput) => {
      const res = await apiClient.patch<RecurringSchedule>(`/fees/schedules/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recurringScheduleKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: recurringScheduleKeys.lists() });
    },
  });
}

export function useDeleteRecurringSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/fees/schedules/${id}`);
    },
    retry: shouldRetryQuery,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: recurringScheduleKeys.lists() });
      queryClient.removeQueries({ queryKey: recurringScheduleKeys.detail(id) });
    },
  });
}

export function useRunRecurringScheduleNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<RecurringSchedule>(`/fees/schedules/${id}/run`);
      return res.data;
    },
    retry: false,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: recurringScheduleKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: recurringScheduleKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: ['fee-generations'] });
    },
  });
}

export function useCloneRecurringSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; academic_year_id: string; name?: string }) => {
      const { id, ...body } = input;
      const res = await apiClient.post<RecurringSchedule>(`/fees/schedules/${id}/clone`, body);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recurringScheduleKeys.lists() });
    },
  });
}

export function useRecurringSchedulePreview() {
  return useMutation({
    mutationFn: async (input: CreateRecurringScheduleInput) => {
      const res = await apiClient.post<RecurringSchedulePreviewResult>(
        '/fees/schedules/preview',
        input,
      );
      return res.data;
    },
    retry: false,
  });
}

export function useAddScheduleExclusion(scheduleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { student_id: string; reason?: string }) => {
      const res = await apiClient.post<RecurringScheduleExclusion>(
        `/fees/schedules/${scheduleId}/exclusions`,
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recurringScheduleKeys.detail(scheduleId) });
    },
  });
}

export function useRemoveScheduleExclusion(scheduleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (studentId: string) => {
      await apiClient.delete(`/fees/schedules/${scheduleId}/exclusions/${studentId}`);
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recurringScheduleKeys.detail(scheduleId) });
    },
  });
}

export function studentScheduleCoverageQueryOptions(studentId: string) {
  return queryOptions({
    queryKey: ['students', 'detail', studentId, 'schedules'] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StudentScheduleCoverage>(`/students/${studentId}/schedules`, {
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useStudentScheduleCoverage(studentId: string | undefined) {
  return useQuery({
    ...studentScheduleCoverageQueryOptions(studentId ?? ''),
    enabled: studentId !== undefined,
  });
}

/** Student-tab "Include again"/one-off inclusion path — an inclusion is
 * just removing a per-student exclusion the student never had, so it's
 * really a targeted `POST .../exclusions` reversal. Modelled as its own
 * hook for readability at the call site even though it wraps the same
 * remove-exclusion request `useRemoveScheduleExclusion` does. */
export function useIncludeStudentInSchedule(scheduleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (studentId: string) => {
      await apiClient.delete(`/fees/schedules/${scheduleId}/exclusions/${studentId}`);
    },
    onSuccess: (_data, studentId) => {
      void queryClient.invalidateQueries({ queryKey: recurringScheduleKeys.detail(scheduleId) });
      void queryClient.invalidateQueries({
        queryKey: ['students', 'detail', studentId, 'schedules'],
      });
    },
  });
}
