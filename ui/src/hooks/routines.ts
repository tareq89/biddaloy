import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import type { ClassSectionWithCount } from './classes';
import { classesQueryOptions } from './classes';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/**
 * [21.7.1] Shift / period-slot / room CRUD hooks — setup screens only.
 * Mirrors `academic-years.ts`'s shape (list/detail query options + CRUD
 * mutations, `createEntityKeys` for cache keys). Not in this ticket's
 * `## Files` list, but no earlier 21.x client ticket shipped it and the
 * setup panels can't fetch/mutate without it — flagged in the PR
 * description as an out-of-territory addition rather than silently
 * added.
 */
export type Shift = components['schemas']['Shift'];
export type CreateShiftInput = components['schemas']['CreateShiftDto'];
export type UpdateShiftInput = components['schemas']['UpdateShiftDto'];
export type PeriodSlot = components['schemas']['PeriodSlot'];
export type PeriodSlotItem = components['schemas']['PeriodSlotItemDto'];
export type PeriodSlotKind = PeriodSlotItem['kind'];
export type Room = components['schemas']['Room'];
export type CreateRoomInput = components['schemas']['CreateRoomDto'];
export type UpdateRoomInput = components['schemas']['UpdateRoomDto'];

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ChangeoverSuggestion {
  sequence: number;
  starts_at: string;
  ends_at: string;
}

// --- Shifts ---

export const shiftKeys = createEntityKeys('routine-shifts');

export function shiftsQueryOptions() {
  return queryOptions({
    queryKey: shiftKeys.list({}),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedResult<Shift>>('/routines/shifts', {
        params: { limit: 100 },
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useShifts() {
  return useQuery(shiftsQueryOptions());
}

export function useCreateShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateShiftInput) => {
      const res = await apiClient.post<Shift>('/routines/shifts', input);
      return res.data;
    },
    // [21.8.1] No retry on create — if the server already committed the
    // POST before the response reached the client (network blip, timeout),
    // a retry resends a non-idempotent create and risks a duplicate.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shiftKeys.lists() });
    },
  });
}

export function useUpdateShift(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateShiftInput) => {
      const res = await apiClient.patch<Shift>(`/routines/shifts/${id}`, input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shiftKeys.lists() });
    },
  });
}

export function useDeleteShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/routines/shifts/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shiftKeys.lists() });
    },
  });
}

// --- Period slots (nested under a shift) ---

export function periodSlotsQueryOptions(shiftId: string) {
  return queryOptions({
    queryKey: [...shiftKeys.detail(shiftId), 'period-slots'] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PeriodSlot[]>(`/routines/shifts/${shiftId}/period-slots`, {
        signal,
      });
      return res.data;
    },
    enabled: shiftId !== '',
    retry: shouldRetryQuery,
  });
}

export function usePeriodSlots(shiftId: string | undefined) {
  return useQuery({ ...periodSlotsQueryOptions(shiftId ?? ''), enabled: Boolean(shiftId) });
}

export function useReplacePeriodSlots(shiftId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (slots: PeriodSlotItem[]) => {
      const res = await apiClient.put<PeriodSlot[]>(`/routines/shifts/${shiftId}/period-slots`, {
        slots,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: (slots) => {
      queryClient.setQueryData([...shiftKeys.detail(shiftId), 'period-slots'] as const, slots);
    },
  });
}

// --- Rooms ---

export const roomKeys = createEntityKeys('routine-rooms');

export function roomsQueryOptions() {
  return queryOptions({
    queryKey: roomKeys.list({}),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<PaginatedResult<Room>>('/routines/rooms', {
        params: { limit: 100 },
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useRooms() {
  return useQuery(roomsQueryOptions());
}

export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRoomInput) => {
      const res = await apiClient.post<Room>('/routines/rooms', input);
      return res.data;
    },
    // [21.8.1] No retry on create — same reasoning as `useCreateShift`.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roomKeys.lists() });
    },
  });
}

export function useUpdateRoom(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateRoomInput) => {
      const res = await apiClient.patch<Room>(`/routines/rooms/${id}`, input);
      return res.data;
    },
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roomKeys.lists() });
    },
  });
}

export function useDeleteRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/routines/rooms/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roomKeys.lists() });
    },
  });
}

// --- Routine document, slots, greedy-fill, workload [21.8.1] ---
//
// `schema.d.ts` has no typed response body for any of `findSlots`/
// `createSlot`/`updateSlot`/`greedyFill`/`workload` (untyped
// `Record<string, never>`, same generator gap `ClassWithCounts` above
// already documents) — hand-typed here against the service's own return
// interfaces (`RoutineSlotWithWarnings`, `ProposedSlot`, `TeacherWorkload`
// in `server/src/modules/routines/*.ts`).

export type Routine = components['schemas']['Routine'];

export type ViolationCode =
  | 'BREAK_SLOT'
  | 'TEACHER_DOUBLE_BOOKED'
  | 'SECTION_DOUBLE_BOOKED'
  | 'ROOM_DOUBLE_BOOKED'
  | 'TEACHER_OVER_DAILY_LIMIT';

export type WarningCode = 'TEACHER_NOT_ASSIGNED' | 'TEACHER_OVER_CONSECUTIVE_LIMIT';

export interface ConstraintViolation {
  code: ViolationCode;
  message: string;
}

export interface ConstraintWarning {
  code: WarningCode;
  message: string;
}

export type SlotRecurrenceValue = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export interface RoutineSlot {
  id: string;
  tenant_id: string;
  routine_id: string;
  section_id: string;
  period_slot_id: string;
  weekday: number;
  subject_id: string;
  room_id: string | null;
  recurrence: SlotRecurrenceValue;
  recurrence_offset: number;
  valid_from: string;
  valid_to: string | null;
}

export interface RoutineSlotWithWarnings {
  slot: RoutineSlot;
  teacher_ids: string[];
  warnings: ConstraintWarning[];
}

export interface UpsertRoutineSlotInput {
  section_id: string;
  period_slot_id: string;
  weekday: number;
  subject_id: string;
  room_id?: string | null;
  recurrence: SlotRecurrenceValue;
  recurrence_offset?: number;
  valid_from: string;
  valid_to?: string | null;
  teacher_ids: string[];
}

export interface ProposedSlot {
  section_id: string;
  period_slot_id: string;
  weekday: number;
  subject_id: string;
  teacher_ids: string[];
  recurrence: SlotRecurrenceValue;
  recurrence_offset: number;
  valid_from: string;
  valid_to: string | null;
}

export interface TeacherWorkload {
  teacher_id: string;
  periods_per_week: number;
  periods_per_day: Record<number, number>;
}

export const routineKeys = createEntityKeys('routines');

export function routinesQueryOptions() {
  return queryOptions({
    queryKey: routineKeys.list({}),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<Routine[]>('/routines', { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useRoutines() {
  return useQuery(routinesQueryOptions());
}

export function routineSlotsQueryOptions(routineId: string) {
  return queryOptions({
    queryKey: [...routineKeys.detail(routineId), 'slots'] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<RoutineSlotWithWarnings[]>(`/routines/${routineId}/slots`, {
        signal,
      });
      return res.data;
    },
    enabled: routineId !== '',
    retry: shouldRetryQuery,
  });
}

export function useRoutineSlots(routineId: string | undefined) {
  return useQuery({ ...routineSlotsQueryOptions(routineId ?? ''), enabled: Boolean(routineId) });
}

/** Read-only [1] `errors.ts`'s `ApiError.details` is where
 * `RoutineSlotsService`'s 409 conflict now lands its `violations` array
 * (server/src/modules/routines/routine-slots.service.ts, [21.8.1]) — this
 * pulls it back out with the narrowing every other `.details` consumer
 * in this codebase does. `undefined` for any other error shape. */
export function conflictViolations(error: unknown): ConstraintViolation[] | undefined {
  const candidate = error as { details?: { violations?: unknown } } | null | undefined;
  const violations = candidate?.details?.violations;
  return Array.isArray(violations) ? (violations as ConstraintViolation[]) : undefined;
}

function invalidateRoutineSlots(queryClient: ReturnType<typeof useQueryClient>, routineId: string) {
  void queryClient.invalidateQueries({ queryKey: [...routineKeys.detail(routineId), 'slots'] });
  void queryClient.invalidateQueries({ queryKey: [...routineKeys.detail(routineId), 'workload'] });
}

export function useCreateRoutineSlot(routineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertRoutineSlotInput) => {
      const res = await apiClient.post<RoutineSlotWithWarnings>(
        `/routines/${routineId}/slots`,
        input,
      );
      return res.data;
    },
    onSuccess: () => invalidateRoutineSlots(queryClient, routineId),
  });
}

export function useUpdateRoutineSlot(routineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ slotId, input }: { slotId: string; input: UpsertRoutineSlotInput }) => {
      const res = await apiClient.patch<RoutineSlotWithWarnings>(
        `/routines/slots/${slotId}`,
        input,
      );
      return res.data;
    },
    onSuccess: () => invalidateRoutineSlots(queryClient, routineId),
  });
}

export function useDeleteRoutineSlot(routineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (slotId: string) => {
      await apiClient.delete(`/routines/slots/${slotId}`);
    },
    onSuccess: () => invalidateRoutineSlots(queryClient, routineId),
  });
}

/** Proposal-only — never writes. `-fill-assist-dialog.tsx` calls this,
 * shows the result as a diff, then re-uses `useCreateRoutineSlot` per
 * accepted proposal on confirm (D9: the write path is the only authority,
 * this is a convenience proposer). A mutation, not a query: it's triggered
 * on demand by opening the dialog, not kept warm in the background. */
export function useGreedyFill(routineId: string) {
  return useMutation({
    mutationFn: async (weekdays?: number[]) => {
      const res = await apiClient.get<ProposedSlot[]>(`/routines/${routineId}/greedy-fill`, {
        params: weekdays ? { weekdays } : undefined,
      });
      return res.data;
    },
  });
}

export function workloadQueryOptions(routineId: string) {
  return queryOptions({
    queryKey: [...routineKeys.detail(routineId), 'workload'] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<TeacherWorkload[]>(`/routines/${routineId}/workload`, {
        signal,
      });
      return res.data;
    },
    enabled: routineId !== '',
    retry: shouldRetryQuery,
  });
}

export function useWorkload(routineId: string | undefined) {
  return useQuery({ ...workloadQueryOptions(routineId ?? ''), enabled: Boolean(routineId) });
}

// --- State transitions, change requests, substitutions [21.9.1] ---
//
// D11's state machine (DRAFT -> REVIEW -> PUBLISHED, no way back out of
// PUBLISHED) and D12's change-request / substitution flows. All three
// response bodies are fully typed in `schema.d.ts` already (`Routine`,
// `RoutineChangeRequest`, `RoutineSubstitution`) — only the copy-year
// response is untyped (`Record<string, never>`), hand-typed below against
// `CopyRoutineService.copyToYear`'s own `CopyRoutineResult` interface
// (server/src/modules/routines/copy-routine.service.ts).

export type ChangeRequestStateValue = components['schemas']['RoutineChangeRequest']['state'];
export type RoutineChangeRequest = components['schemas']['RoutineChangeRequest'];
export type CreateChangeRequestInput = components['schemas']['CreateChangeRequestDto'];
export type ResolveChangeRequestInput = components['schemas']['ResolveChangeRequestDto'];
export type RoutineSubstitution = components['schemas']['RoutineSubstitution'];
export type UpsertSubstitutionInput = components['schemas']['UpsertSubstitutionDto'];
export type CopyRoutineInput = components['schemas']['CopyRoutineDto'];

export interface UnmappedSection {
  source_section_id: string;
  class_name: string;
  section_name: string;
}

export interface UnmappedSubject {
  source_subject_id: string;
  code: string;
}

export interface CopyRoutineResult {
  routine: Routine;
  unmapped_sections: UnmappedSection[];
  unmapped_subjects: UnmappedSubject[];
  skipped_slot_count: number;
}

function invalidateRoutines(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: routineKeys.lists() });
}

export function useSubmitForReview(routineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<Routine>(`/routines/${routineId}/submit-for-review`);
      return res.data;
    },
    onSuccess: () => invalidateRoutines(queryClient),
  });
}

export function useWithdrawRoutine(routineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<Routine>(`/routines/${routineId}/withdraw`);
      return res.data;
    },
    onSuccess: () => invalidateRoutines(queryClient),
  });
}

export function usePublishRoutine(routineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<Routine>(`/routines/${routineId}/publish`);
      return res.data;
    },
    onSuccess: () => invalidateRoutines(queryClient),
  });
}

/** D19: copies every slot into a new DRAFT routine for another academic
 * year. Reports what it couldn't remap — the caller decides whether that
 * matters, this never silently drops anything without saying so. */
export function useCopyRoutineYear(routineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CopyRoutineInput) => {
      const res = await apiClient.post<CopyRoutineResult>(
        `/routines/${routineId}/copy-year`,
        input,
      );
      return res.data;
    },
    onSuccess: () => invalidateRoutines(queryClient),
  });
}

export const changeRequestKeys = createEntityKeys('routine-change-requests');

export function changeRequestsQueryOptions(routineId: string) {
  return queryOptions({
    queryKey: [...changeRequestKeys.detail(routineId)] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<RoutineChangeRequest[]>(
        `/routines/${routineId}/change-requests`,
        { signal },
      );
      return res.data;
    },
    enabled: routineId !== '',
    retry: shouldRetryQuery,
  });
}

/** ADMIN/EXECUTIVE-only server-side (`ROUTINE_MANAGE`) — this is the
 * builder's queue, not the teacher's own view. */
export function useChangeRequests(routineId: string | undefined) {
  return useQuery({
    ...changeRequestsQueryOptions(routineId ?? ''),
    enabled: Boolean(routineId),
  });
}

function invalidateChangeRequests(
  queryClient: ReturnType<typeof useQueryClient>,
  routineId: string,
) {
  void queryClient.invalidateQueries({ queryKey: changeRequestKeys.detail(routineId) });
}

/** A teacher flagging a *published* slot for the builder's attention —
 * `ROUTINE_READ` server-side, no elevated permission needed. */
export function useOpenChangeRequest(routineId: string, slotId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateChangeRequestInput) => {
      const res = await apiClient.post<RoutineChangeRequest>(
        `/routines/slots/${slotId}/change-requests`,
        input,
      );
      return res.data;
    },
    onSuccess: () => invalidateChangeRequests(queryClient, routineId),
  });
}

/** Accept or reject — never edits the routine itself (D11). Any
 * `ROUTINE_MANAGE` holder may resolve it, not only the routine's author. */
export function useResolveChangeRequest(routineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ResolveChangeRequestInput }) => {
      const res = await apiClient.patch<RoutineChangeRequest>(
        `/routines/change-requests/${id}`,
        input,
      );
      return res.data;
    },
    onSuccess: () => invalidateChangeRequests(queryClient, routineId),
  });
}

export const substitutionKeys = createEntityKeys('routine-substitutions');

export interface SubstitutionFilters {
  from?: string | undefined;
  to?: string | undefined;
  substitute_teacher_id?: string | undefined;
  covered_for_teacher_id?: string | undefined;
  section_id?: string | undefined;
}

export function substitutionsQueryOptions(filters: SubstitutionFilters) {
  return queryOptions({
    queryKey: substitutionKeys.list({ ...filters }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<RoutineSubstitution[]>('/routines/substitutions', {
        params: filters,
        signal,
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

/** The dated cover/cancellation log — `ROUTINE_MANAGE`, all three roles
 * (`ADMIN`, `EXECUTIVE`, `TEACHER`) may read it server-side. */
export function useSubstitutions(filters: SubstitutionFilters) {
  return useQuery(substitutionsQueryOptions(filters));
}

/** Records a cover or cancellation for one slot on one date (D12). Never
 * touches `routine_slots` — refuses (422) when the slot doesn't occur on
 * that date, a sign the caller has the wrong slot; that message is
 * surfaced verbatim by `-substitution-dialog.tsx`, never re-worded here. */
export function useRecordSubstitution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertSubstitutionInput) => {
      const res = await apiClient.post<RoutineSubstitution>('/routines/substitutions', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: substitutionKeys.lists() });
    },
  });
}

// --- Resolve, the one dated-agenda read path [21.10.1] D14 ---
//
// `ResolveRoutineController_resolve_v1`'s 200 body is untyped in
// `schema.d.ts` (`Record<string, never>[]`, the same generator gap this
// file documents above for `RoutineSlotWithWarnings` etc.) — hand-typed
// here against `ResolveRoutineService`'s own `ResolvedSlot` interface
// (server/src/modules/routines/dto/resolve.dto.ts). This is the **only**
// client read path for "what happens on this date" — recurrence,
// effective-dating, weekly-off/holiday exclusion and substitutions are
// already applied server-side; nothing here re-derives any of it.

/** One resolved, dated slot. Mirror of the server's `ResolvedSlot`. */
export interface ResolvedSlot {
  date: string;
  routine_slot_id: string;
  section_id: string;
  period_slot_id: string;
  weekday: number;
  subject_id: string;
  room_id: string | null;
  kind: string;
  teacher_ids: string[];
  substituted: boolean;
  cancelled: boolean;
  substitute_teacher_id?: string;
  covering_for_teacher_ids?: string[];
}

export interface ResolveRoutineFilters {
  section_id?: string | undefined;
  teacher_id?: string | undefined;
  student_id?: string | undefined;
  from: string;
  to: string;
  include_breaks?: boolean | undefined;
}

export const resolveRoutineKeys = {
  all: (filters: ResolveRoutineFilters) => ['routines-resolve', filters] as const,
};

/** `undefined` filters (e.g. the caller's own teacher record hasn't
 * loaded yet) disables the query rather than firing with a garbage
 * `section_id`/`teacher_id`/`student_id` combination the server would
 * 400 on. */
export function useResolveRoutine(filters: ResolveRoutineFilters | undefined) {
  return useQuery({
    queryKey: resolveRoutineKeys.all(filters ?? { from: '', to: '' }),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<ResolvedSlot[]>('/routines/resolve', {
        params: filters,
        signal,
      });
      return res.data;
    },
    enabled: !!filters,
    retry: shouldRetryQuery,
  });
}

/** Every period slot's timing/sequence, id-keyed, across every shift.
 * `resolveRoutine` deliberately returns only `period_slot_id` (D14 is
 * about slot resolution, not period metadata), and there is no "period
 * slots for these ids" endpoint — so this fetches each shift's period
 * slots once and flattens them into one map. A school runs a handful of
 * shifts, never hundreds, so this comfortably covers every section's
 * agenda in one extra round-trip per shift (cached by react-query, not
 * re-fetched per agenda render). */
export interface PeriodSlotLookupEntry {
  sequence: number;
  kind: PeriodSlotKind;
  name: string | null;
  starts_at: string;
  ends_at: string;
}

export function usePeriodSlotLookup() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['routine-period-slot-lookup'],
    // [21.9.1] Fetches shifts through `queryClient.fetchQuery` on the
    // shared `shiftsQueryOptions` (cache-sharing, throws on error) rather
    // than gating on `useShifts().isSuccess` — that left this query stuck
    // `isPending` forever if the shift fetch ever failed, since a
    // `enabled: false` query never becomes `isError`. Callers that check
    // isPending/isError (my.tsx, portal/routine.tsx) need the real state.
    queryFn: async ({ signal }) => {
      const shifts = (await queryClient.fetchQuery(shiftsQueryOptions())).data;
      const lists = await Promise.all(
        shifts.map((shift) =>
          apiClient
            .get<PeriodSlot[]>(`/routines/shifts/${shift.id}/period-slots`, { signal })
            .then((res) => res.data),
        ),
      );
      const map: Record<string, PeriodSlotLookupEntry> = {};
      for (const list of lists) {
        for (const slot of list) {
          map[slot.id] = {
            sequence: slot.sequence,
            kind: slot.kind,
            name: slot.name,
            starts_at: slot.starts_at,
            ends_at: slot.ends_at,
          };
        }
      }
      return map;
    },
    retry: shouldRetryQuery,
  });
}

/** Every section's class+section label, id-keyed, across every class —
 * same "no lookup-by-id endpoint, so flatten every list once" reasoning
 * as `usePeriodSlotLookup` above. The teacher agenda needs "Class 6A" for
 * a resolved slot that only carries `section_id`. */
export interface SectionLookupEntry {
  className: string;
  sectionName: string;
}

export function useSectionLookup() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['routine-section-lookup'],
    // Same isPending-forever-on-parent-failure fix as usePeriodSlotLookup
    // above.
    queryFn: async ({ signal }) => {
      const classes = (await queryClient.fetchQuery(classesQueryOptions())).data;
      const lists = await Promise.all(
        classes.map((klass) =>
          apiClient
            .get<ClassSectionWithCount[]>(`/classes/${klass.id}/sections`, { signal })
            .then((res) => res.data.map((section) => ({ section, className: klass.name }))),
        ),
      );
      const map: Record<string, SectionLookupEntry> = {};
      for (const list of lists) {
        for (const { section, className } of list) {
          map[section.id] = { className, sectionName: section.section_name };
        }
      }
      return map;
    },
    retry: shouldRetryQuery,
  });
}
