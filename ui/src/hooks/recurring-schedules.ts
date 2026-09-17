import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/**
 * [16.7.5] Client hooks for `RecurringSchedule` CRUD.
 *
 * Server ticket #675 has landed, so `schema.d.ts` carries the real
 * `/fees/schedules` contract. Every request/response shape below is a
 * `components['schemas'][...]` alias — the same convention `invoices.ts`
 * and the other entity hooks in this directory follow. Do not re-introduce
 * hand-typed shapes here: the interim ones that used to live in this file
 * had drifted from the server (`audience.active_only` instead of the
 * required `audience.enrollment_status`, `rule.mode` instead of the
 * required `rule.kind`, `'MON'`-style weekday strings instead of ISO
 * weekday numbers), so every create/edit request the UI sent was rejected.
 */

export type RecurringScheduleAudience = components['schemas']['RecurringScheduleAudienceDto'];
export type RecurringScheduleRule = components['schemas']['RecurringScheduleRuleDto'];

/** `'MONTHLY' | 'WEEKLY'`. Lives on `rule.kind` — the server has no
 * `rule.mode`, and `kind` is required (`@IsIn`), so omitting it is a 400. */
export type RecurringScheduleRuleKind = RecurringScheduleRule['kind'];

/** Day-of-month rule: 1-28, or the literal `'LAST'` for "last day of the
 * month" (handles 30/31/Feb without a magic 29-31 number). */
export type MonthlyRuleDay = NonNullable<RecurringScheduleRule['day_of_month']>;

/** An ISO-8601 weekday number: 1 = Monday … 7 = Sunday. The server's
 * `recurrence.util.ts` and `RecurringSchedulesService.validateRule` speak
 * ISO numbers; they never accept `'MON'`/`'TUE'` strings. */
export type Weekday = number;

export const ISO_WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export type RecurringSchedule = components['schemas']['RecurringScheduleResponseDto'];
export type CreateRecurringScheduleInput = components['schemas']['CreateRecurringScheduleDto'];
export type UpdateRecurringScheduleInput = components['schemas']['UpdateRecurringScheduleDto'];
export type AddExclusionInput = components['schemas']['AddExclusionDto'];
export type CloneScheduleResult = components['schemas']['CloneScheduleResultDto'];
export type SchedulePreview = components['schemas']['SchedulePreviewDto'];
export type SchedulePreviewStudent = components['schemas']['SchedulePreviewStudentDto'];

/** One row of `GET /students/:id/schedules` — the schedules whose audience
 * currently matches the student, with the ones they are explicitly
 * excluded from flagged via `excluded`. */
export type StudentScheduleItem = components['schemas']['StudentScheduleItemDto'];

/**
 * KNOWN SERVER GAP (#675): there is no endpoint that reads a schedule's
 * exclusion list back. `POST .../exclusions` and `DELETE
 * .../exclusions/:studentId` exist, but `RecurringScheduleResponseDto`
 * carries no `exclusions` array and there is no `GET .../exclusions`, so
 * the schedule-detail exclusions table can add and remove rows but cannot
 * list existing ones. Typed as optional here rather than pretended into
 * `RecurringSchedule` so the gap stays visible.
 */
export interface RecurringScheduleExclusion {
  student_id: string;
  student_name: string;
  reason: string | null;
  created_at: string;
}

export type RecurringScheduleDetail = RecurringSchedule & {
  /** See `RecurringScheduleExclusion` — never populated by the server today. */
  exclusions?: RecurringScheduleExclusion[];
};

/**
 * The only query parameters `QueryRecurringSchedulesDto` accepts. The
 * global pipe runs with `forbidNonWhitelisted: true`, so sending anything
 * else (the old interim `page`/`limit`) makes `GET /fees/schedules` 400.
 * The endpoint returns the tenant's full list, unpaginated.
 */
export interface RecurringScheduleListFilters {
  academic_year_id?: string;
  is_active?: boolean;
}

export const recurringScheduleKeys =
  createEntityKeys<RecurringScheduleListFilters>('recurring-schedules');

export function recurringSchedulesQueryOptions(filters: RecurringScheduleListFilters = {}) {
  return queryOptions({
    queryKey: recurringScheduleKeys.list(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<RecurringSchedule[]>('/fees/schedules', {
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
      const res = await apiClient.get<RecurringScheduleDetail>(`/fees/schedules/${id}`, { signal });
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
    // No retry — POST isn't idempotent, matching useCreateFeeStructure's
    // reasoning (a double-submit would create a second schedule that
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

export function useCloneRecurringSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    // `CloneScheduleDto` is `{ academic_year_id }` only — the target year.
    // The interim contract also sent `name`, which now 400s under
    // `forbidNonWhitelisted`.
    mutationFn: async (input: { id: string; academic_year_id: string }) => {
      const { id, academic_year_id } = input;
      const res = await apiClient.post<CloneScheduleResult>(`/fees/schedules/${id}/clone`, {
        academic_year_id,
      });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recurringScheduleKeys.lists() });
    },
  });
}

export const schedulePreviewKeys = createEntityKeys<never, string>('recurring-schedule-preview');

/**
 * `GET /fees/schedules/:id/preview` — who a *saved* schedule would bill
 * today (count plus the first 50 students). There is no preview-an-unsaved-
 * draft endpoint, so the create/edit dialog can only preview in edit mode.
 */
export function schedulePreviewQueryOptions(id: string) {
  return queryOptions({
    queryKey: schedulePreviewKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<SchedulePreview>(`/fees/schedules/${id}/preview`, { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useSchedulePreview(id: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    ...schedulePreviewQueryOptions(id ?? ''),
    enabled: id !== undefined && id !== '' && options.enabled !== false,
  });
}

export function useAddScheduleExclusion(scheduleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // `reason` is required by `AddExclusionDto` (`@IsNotEmpty`).
    mutationFn: async (input: AddExclusionInput) => {
      await apiClient.post(`/fees/schedules/${scheduleId}/exclusions`, input);
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: recurringScheduleKeys.detail(scheduleId) });
      void queryClient.invalidateQueries({
        queryKey: studentScheduleCoverageKeys.detail(input.student_id),
      });
    },
  });
}

/** Removing an exclusion (the schedule-detail `-exclusions-table.tsx` row
 * action) and "include again" (the student tab's own context) are both just
 * `DELETE .../exclusions/:studentId`, so they share one mutation, which
 * invalidates both the schedule detail and the student's own coverage query
 * so neither view goes stale regardless of which screen fired it. */
export function useRemoveScheduleExclusion(scheduleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (studentId: string) => {
      await apiClient.delete(`/fees/schedules/${scheduleId}/exclusions/${studentId}`);
    },
    retry: shouldRetryQuery,
    onSuccess: (_data, studentId) => {
      void queryClient.invalidateQueries({ queryKey: recurringScheduleKeys.detail(scheduleId) });
      void queryClient.invalidateQueries({
        queryKey: studentScheduleCoverageKeys.detail(studentId),
      });
    },
  });
}

export const studentScheduleCoverageKeys = createEntityKeys<never, string>(
  'student-schedule-coverage',
);

export function studentScheduleCoverageQueryOptions(studentId: string) {
  return queryOptions({
    queryKey: studentScheduleCoverageKeys.detail(studentId),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StudentScheduleItem[]>(`/students/${studentId}/schedules`, {
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

/** Student-tab "Include again" (a schedule the student is currently
 * excluded from) is the same request as `-exclusions-table.tsx`'s own
 * "remove exclusion" row action — see `useRemoveScheduleExclusion`'s
 * comment. Aliased under this name at call sites in the student tab for
 * readability; not a second implementation. */
export const useIncludeStudentInSchedule = useRemoveScheduleExclusion;
