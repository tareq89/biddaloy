/**
 * [9.6] Teacher marking UI's data layer — `GET /attendance/my-sections`,
 * `GET/PUT /attendance/sections/:sectionId/register`.
 *
 * The one thing worth reading before touching this file:
 * `useSubmitRegister`'s `mutationFn` is 8.12's offline mutation queue's
 * **first real caller**. Everything else in `api/mutation-queue.ts` was
 * built and tested against a mock until this landed. See its own
 * docstring below for the online/offline/conflict contract.
 */
import type { AttendanceStatus } from '@biddaloy/shared';
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '../api/client';
import { enqueueMutation } from '../api/mutation-queue';
import { isNoResponseNetworkError, offlineCachedQueryFn } from '../api/offline-cache';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type MySection = components['schemas']['MySectionDto'];
export type Register = components['schemas']['RegisterResponseDto'];
export type PutRegisterInput = components['schemas']['PutRegisterDto'];
export type RegisterEntry = components['schemas']['RegisterEntryDto'];
export type RegisterStudent = components['schemas']['RegisterStudentDto'];
export type CorrectRecordInput = components['schemas']['CorrectRecordDto'];
export type RecordHistoryEntry = components['schemas']['AuditLogResponseDto'];
export type RecordHistoryResponse = components['schemas']['RecordHistoryResponseDto'];

export interface AttendanceListFilters {
  date?: string;
}

export const attendanceKeys = createEntityKeys<AttendanceListFilters>('attendance');

/**
 * `GET /attendance/my-sections` — the sections *this* teacher is mapped
 * to, server-scoped (`AttendanceAccessService`, `teacher_class_sections`).
 * Deliberately not a client-side filter over `/classes/:id/sections`,
 * which would ship the whole tenant's section list to a teacher's phone
 * to filter down locally — see the plan's "Plan corrections".
 */
export function mySectionsQueryOptions(date?: string) {
  const queryKey = attendanceKeys.list(date === undefined ? {} : { date });
  return queryOptions({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<MySection[]>('/attendance/my-sections', {
        params: date === undefined ? undefined : { date },
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useMySections(date?: string) {
  return useQuery(mySectionsQueryOptions(date));
}

/** Own key branch, not `attendanceKeys.detail(sectionId)` — a register is
 * scoped by section *and* date *and* (optionally) period, none of which
 * fit the single-id `detail()` shape the rest of this factory offers. */
export function sectionRegisterKey(sectionId: string | undefined, date: string, periodNo?: number) {
  return [...attendanceKeys.all, 'register', sectionId, date, periodNo ?? null] as const;
}

/**
 * [8.12.3] offline read cache — same `offlineCachedQueryFn` wiring as
 * `classes.ts`'s `classSectionsQueryOptions`. `entity: 'attendance-register'`
 * is a `CacheableEntity`, not a `QueueableEntity` — this is a *read*, the
 * write path below never touches this cache.
 */
export function sectionRegisterQueryOptions(
  sectionId: string | undefined,
  date: string,
  periodNo?: number,
) {
  const queryKey = sectionRegisterKey(sectionId, date, periodNo);
  return queryOptions({
    queryKey,
    queryFn: offlineCachedQueryFn<Register>({
      entity: 'attendance-register',
      queryKey,
      fetch: (signal) =>
        apiClient.get<Register>(`/attendance/sections/${sectionId}/register`, {
          params: { date, ...(periodNo === undefined ? {} : { period_no: periodNo }) },
          signal,
        }),
    }),
    enabled: sectionId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useSectionRegister(sectionId: string | undefined, date: string, periodNo?: number) {
  return useQuery(sectionRegisterQueryOptions(sectionId, date, periodNo));
}

/** What `useSubmitRegister`'s `mutationFn` resolves with — see its own
 * docstring for what `queued: true` means to the caller. */
export interface SubmitRegisterResult {
  queued: boolean;
  register?: Register;
}

/**
 * `PUT /attendance/sections/:sectionId/register` — 9.6's whole reason to
 * exist: the first product mutation to call `enqueueMutation` (8.12.4)
 * for real.
 *
 * Contract, worth stating precisely because every rule here is load
 * bearing:
 *
 * - **Offline (`navigator.onLine === false`)**: never even attempts the
 *   request — queue immediately and tell the caller `{ queued: true }`.
 * - **Online, but the request itself fails with no response** (a dropped
 *   connection mid-flight, `isNoResponseNetworkError`): same outcome,
 *   queued.
 * - **Online, server answered** (200, 409, or anything else): resolved
 *   or thrown straight through. A 409 (stale `base_version`) is *not*
 *   queued — the caller owns conflict resolution
 *   (`-conflict-dialog.tsx`), and silently retrying a stale write would
 *   be exactly the data loss the conflict check exists to prevent.
 * - **`enqueueMutation` itself can throw** (`QueueUnavailableError`,
 *   `ForbiddenQueueMutationError`) — deliberately left unswallowed. The
 *   caller is about to tell the teacher "saved, will sync" and must not
 *   say that when nothing was persisted anywhere.
 * - **No optimistic cache update.** The marking screen owns its own
 *   draft state; writing an optimistic register into the query cache
 *   here would add a rollback path nobody exercises.
 *
 * `input.client_request_id` must be generated **once per submit attempt
 * by the caller** (`crypto.randomUUID()`) and reused across retries of
 * that same attempt — the server's idempotency contract (9.3) collapses
 * a queued row replayed twice into a single write only if the id is
 * stable.
 */
export function useSubmitRegister(sectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PutRegisterInput): Promise<SubmitRegisterResult> => {
      const path = `/attendance/sections/${sectionId}/register`;
      const send = async () => (await apiClient.put<Register>(path, input)).data;

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        // Never attempted — no point paying a doomed request's timeout.
        await enqueueMutation({ entity: 'attendance', method: 'put', path, body: input });
        return { queued: true };
      }

      try {
        const register = await send();
        return { queued: false, register };
      } catch (error) {
        if (isNoResponseNetworkError(error)) {
          await enqueueMutation({ entity: 'attendance', method: 'put', path, body: input });
          return { queued: true };
        }
        // A real server answer (409 included) belongs to the caller —
        // never swallowed, never queued.
        throw error;
      }
    },
    onSuccess: (result, input) => {
      // Queued rows have not changed server state yet — nothing to
      // invalidate until the queue replays (the replay engine's own
      // `notifyOutcomeFromCommon` covers that moment).
      if (result.queued) return;
      void queryClient.invalidateQueries({
        queryKey: sectionRegisterKey(sectionId, input.date, input.period_no ?? undefined),
      });
      void queryClient.invalidateQueries({ queryKey: attendanceKeys.lists() });
    },
  });
}

// ---------------------------------------------------------------------
// [9.7] PATCH /attendance/records/:recordId, GET .../history
// ---------------------------------------------------------------------

/** One mark's correction/audit trail, paginated. `recordId === undefined`
 * (a row not yet marked has no `record_id`) disables the query rather
 * than firing a request against `/records/undefined/history`. */
export function recordHistoryKey(recordId: string | undefined, page = 1) {
  return [...attendanceKeys.all, 'record-history', recordId, page] as const;
}

export function recordHistoryQueryOptions(recordId: string | undefined, page = 1) {
  return queryOptions({
    queryKey: recordHistoryKey(recordId, page),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<RecordHistoryResponse>(`/attendance/records/${recordId}/history`, {
          params: { page },
          signal,
        })
      ).data,
    enabled: recordId !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useRecordHistory(recordId: string | undefined, page = 1) {
  return useQuery(recordHistoryQueryOptions(recordId, page));
}

export interface CorrectRecordVariables extends Omit<
  CorrectRecordInput,
  'minutes_late' | 'remarks'
> {
  recordId: string;
  // Re-declared with an explicit `| undefined` (rather than the schema's
  // plain optional `?:`) — under `exactOptionalPropertyTypes`, a caller
  // that conditionally includes one of these (e.g. `minutes_late` only
  // for `LATE`) via `{ ...(cond ? { minutes_late: x } : {}) }` still
  // needs to assign an explicit `undefined` in the non-`LATE` branch.
  minutes_late?: number | undefined;
  remarks?: string | undefined;
}

/**
 * `PATCH /attendance/records/:recordId` — a deliberate, low-frequency,
 * reason-typed correction a staff member types at their desk, **not** a
 * queueable mark like `useSubmitRegister`. This plain `apiClient.patch`
 * call is on purpose: it never calls `enqueueMutation`. A correction's
 * `reason` is tied to this record's state *right now*; queueing it would
 * let a reason-carrying edit replay later against a record that has
 * since changed again, or after the tenant's correction window has
 * closed by the time the queue drains. Marking is safe to queue because
 * it's idempotent and window-agnostic; correcting is neither, so it must
 * either succeed now or fail now, not "eventually".
 *
 * No optimistic cache update — `correctRecord` bumps the session's
 * `version` server-side (same as `putRegister`), so the client must
 * re-read the register before its next submit can avoid a 409.
 */
export function useCorrectRecord(sectionId: string, date: string, periodNo?: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ recordId, ...body }: CorrectRecordVariables): Promise<Register> =>
      (await apiClient.patch<Register>(`/attendance/records/${recordId}`, body)).data,
    onSuccess: (_register, variables) => {
      void queryClient.invalidateQueries({
        queryKey: sectionRegisterKey(sectionId, date, periodNo),
      });
      void queryClient.invalidateQueries({ queryKey: recordHistoryKey(variables.recordId) });
    },
  });
}

// ---------------------------------------------------------------------
// [9.9] GET /attendance/students/:studentId/days, .../summary — the two
// exam-facing read endpoints [9.4] shipped, first consumed here by the
// guardian portal's per-child month view.
// ---------------------------------------------------------------------

/** One calendar day of `GET /attendance/students/:studentId/days`. Not a
 * generated `schema.d.ts` type — that endpoint ships without
 * `@ApiOkResponse` (`attendance-summary.controller.ts`'s own comment: it's
 * a thin passthrough of `AttendanceDayDto[]`), so the shape is declared by
 * hand here, matching the server DTO field for field. */
export interface StudentAttendanceDay {
  date: string;
  status: AttendanceStatus | null;
  minutes_late: number | null;
  remarks: string | null;
  is_working_day: boolean;
  holiday_name: string | null;
}

/** `GET /attendance/students/:studentId/summary`'s frozen contract shape
 * — `schema.d.ts` types this one (it does carry `@ApiOkResponse`). */
export type AttendanceSummary = components['schemas']['AttendanceSummaryDto'];

/** Own key branch, not `attendanceKeys.detail(studentId)` — this is scoped
 * by student *and* month, which doesn't fit the single-id `detail()`
 * shape, same reasoning `sectionRegisterKey` documents for the register. */
export function studentAttendanceDaysKey(studentId: string | undefined, month: string) {
  return [...attendanceKeys.all, 'student', studentId, 'days', month] as const;
}

export function studentAttendanceDaysQueryOptions(studentId: string | undefined, month: string) {
  return queryOptions({
    queryKey: studentAttendanceDaysKey(studentId, month),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StudentAttendanceDay[]>(
        `/attendance/students/${studentId}/days`,
        { params: { month }, signal },
      );
      return res.data;
    },
    enabled: studentId !== undefined,
    retry: shouldRetryQuery,
    // A guardian paging month to month keeps the previous month's grid on
    // screen instead of it collapsing to a loading skeleton every click.
    placeholderData: keepPreviousData,
  });
}

export function useStudentAttendanceDays(studentId: string | undefined, month: string) {
  return useQuery(studentAttendanceDaysQueryOptions(studentId, month));
}

export function studentAttendanceSummaryKey(studentId: string | undefined, month: string) {
  return [...attendanceKeys.all, 'student', studentId, 'summary', month] as const;
}

export function studentAttendanceSummaryQueryOptions(studentId: string | undefined, month: string) {
  return queryOptions({
    queryKey: studentAttendanceSummaryKey(studentId, month),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<AttendanceSummary>(
        `/attendance/students/${studentId}/summary`,
        { params: { month }, signal },
      );
      return res.data;
    },
    enabled: studentId !== undefined,
    retry: shouldRetryQuery,
    placeholderData: keepPreviousData,
  });
}

export function useStudentAttendanceSummary(studentId: string | undefined, month: string) {
  return useQuery(studentAttendanceSummaryQueryOptions(studentId, month));
}

// ---------------------------------------------------------------------
// [9.10] GET /attendance/sections/:sectionId/summary,
// .../register-matrix, GET /attendance/flags/low — the three remaining
// [9.4] read endpoints, consumed here by the staff-facing reports,
// printable register, and low-attendance flag list. No offline caching —
// these are report/admin surfaces, not the daily marking flow 8.12's
// mutation queue exists for, so they deliberately skip
// `offlineCachedQueryFn` (`CacheableEntity` stays exactly what [9.6]/[9.9]
// left it).
// ---------------------------------------------------------------------

export type SectionSummary = components['schemas']['SectionSummaryDto'];
export type StudentSummaryRow = components['schemas']['AttendanceSummaryDto'];
export type RegisterMatrix = components['schemas']['RegisterMatrixDto'];
export type RegisterMatrixRow = components['schemas']['RegisterMatrixRowDto'];
export type LowAttendanceFlag = components['schemas']['LowAttendanceFlagDto'];
export type LowAttendanceListResponse = components['schemas']['LowAttendanceListResponseDto'];

export function sectionSummaryKey(sectionId: string | undefined, from: string, to: string) {
  return [...attendanceKeys.all, 'section-summary', sectionId, from, to] as const;
}

export function sectionSummaryQueryOptions(
  sectionId: string | undefined,
  from: string,
  to: string,
) {
  return queryOptions({
    queryKey: sectionSummaryKey(sectionId, from, to),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<SectionSummary>(`/attendance/sections/${sectionId}/summary`, {
        params: { from, to },
        signal,
      });
      return res.data;
    },
    enabled: sectionId !== undefined,
    retry: shouldRetryQuery,
    placeholderData: keepPreviousData,
  });
}

export function useSectionSummary(sectionId: string | undefined, from: string, to: string) {
  return useQuery(sectionSummaryQueryOptions(sectionId, from, to));
}

export function registerMatrixKey(sectionId: string | undefined, month: string) {
  return [...attendanceKeys.all, 'register-matrix', sectionId, month] as const;
}

export function registerMatrixQueryOptions(sectionId: string | undefined, month: string) {
  return queryOptions({
    queryKey: registerMatrixKey(sectionId, month),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<RegisterMatrix>(
        `/attendance/sections/${sectionId}/register-matrix`,
        { params: { month }, signal },
      );
      return res.data;
    },
    enabled: sectionId !== undefined,
    retry: shouldRetryQuery,
    placeholderData: keepPreviousData,
  });
}

export function useRegisterMatrix(sectionId: string | undefined, month: string) {
  return useQuery(registerMatrixQueryOptions(sectionId, month));
}

export interface LowAttendanceFilters {
  from: string;
  to: string;
  threshold?: number;
  class_id?: string;
  section_id?: string;
  page?: number;
  limit?: number;
}

export function lowAttendanceKey(filters: LowAttendanceFilters) {
  return [...attendanceKeys.all, 'low', filters] as const;
}

export function lowAttendanceQueryOptions(filters: LowAttendanceFilters) {
  return queryOptions({
    queryKey: lowAttendanceKey(filters),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<LowAttendanceListResponse>('/attendance/flags/low', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
    placeholderData: keepPreviousData,
  });
}

export function useLowAttendance(filters: LowAttendanceFilters) {
  return useQuery(lowAttendanceQueryOptions(filters));
}
