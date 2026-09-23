import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

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
    retry: shouldRetryQuery,
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
    retry: shouldRetryQuery,
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
      const res = await apiClient.get<RoutineSlotWithWarnings[]>(
        `/routines/${routineId}/slots`,
        { signal },
      );
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
