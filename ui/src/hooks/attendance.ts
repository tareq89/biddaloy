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
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
