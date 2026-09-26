/**
 * [25.6] Seat plans client hooks — list + generate. Mirrors `exams.ts`'s
 * shape (query-key factory, hand-typed responses) since `SeatPlansService
 * .findAll`/`.generate` have no `@ApiResponse` decoration server-side (same
 * gap `ExamProgress` in `exams.ts` documents) — `schema.d.ts` only types the
 * two routes' request bodies.
 *
 * `GET /seat-plans` returns each plan with `schedule_count`/`room_count`/
 * `student_count` attached server-side (`SeatPlansService.findAll`, #1055) —
 * the bare `SeatPlan` entity has none of these, so the list screen's columns
 * would otherwise need one `findOne` per row.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type GenerateSeatPlanInput = components['schemas']['GenerateSeatPlanDto'];

export interface SeatPlanRow {
  id: string;
  name: string;
  status: 'DRAFT' | 'PUBLISHED';
  seat_order_mode: 'SEQUENTIAL' | 'RANDOM';
  schedule_count: number;
  room_count: number;
  student_count: number;
}

/** One entry of `checkRoomConflicts`'s result — `allocation.ts`'s
 * `RoomConflict`, returned (not thrown) alongside a successful generate so
 * staff can review/acknowledge it (D5, ticket step 5). */
export interface SeatPlanRoomConflict {
  room_id: string;
  conflicting_seat_plan_id: string;
  conflicting_schedule_id: string;
  schedule_id: string;
}

export interface GenerateSeatPlanResult {
  plan: SeatPlanRow & Record<string, unknown>;
  conflicts: SeatPlanRoomConflict[];
}

/** `SeatPlansService.generate`'s 400 `details` payload (D4) — see this
 * module's own doc comment on why the server nests it under `details`. */
export interface SeatCapacityShortfallDetails {
  code: 'SEAT_CAPACITY_SHORTFALL';
  seats_needed: number;
  seats_available: number;
  shortfall: number;
  suggested_rooms: Array<{ room_id: string; capacity: number }>;
}

export const seatPlanKeys = createEntityKeys('seat-plans');

export function seatPlansQueryOptions() {
  return queryOptions({
    queryKey: seatPlanKeys.list({}),
    queryFn: async ({ signal }) =>
      (await apiClient.get<SeatPlanRow[]>('/seat-plans', { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useSeatPlans() {
  return useQuery(seatPlansQueryOptions());
}

export function useGenerateSeatPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: GenerateSeatPlanInput) =>
      (await apiClient.post<GenerateSeatPlanResult>('/seat-plans/generate', input)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: seatPlanKeys.lists() }),
  });
}

/**
 * [25.7] Detail view types. `SeatPlansService.findOne` (server) has no
 * `@ApiResponse` decoration either (same gap this file's own header
 * comment documents for `findAll`/`generate`), so these are hand-typed to
 * match its actual return shape.
 */
export interface SeatPlanAllocationRow {
  id: string;
  exam_schedule_id: string;
  student_id: string;
  student_name: string;
  roll_number: number | null;
  section_name: string | null;
  subject_name: string | null;
  room_id: string;
  seat_number: string;
}

export interface SeatPlanRoomDetail {
  room_id: string;
  room_no: string | null;
  building: string | null;
  capacity: number | null;
  invigilator_user_id: string | null;
  invigilator_name: string | null;
  allocations: SeatPlanAllocationRow[];
}

export interface SeatPlanDetail extends SeatPlanRow {
  rooms: SeatPlanRoomDetail[];
}

export type UpdateAllocationInput = components['schemas']['UpdateAllocationDto'];
export type UpdateInvigilatorInput = components['schemas']['UpdateInvigilatorDto'];

export function seatPlanDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: seatPlanKeys.detail(id),
    queryFn: async ({ signal }) =>
      (await apiClient.get<SeatPlanDetail>(`/seat-plans/${id}`, { signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useSeatPlanDetail(id: string) {
  return useQuery(seatPlanDetailQueryOptions(id));
}

/** [25.7] step 3: move one student to a different room/seat (DRAFT only).
 * `409`/`400` on a taken seat or a full room bubble up as `ApiError` for
 * the dialog to show inline — no optimistic update, the server owns the
 * capacity check. */
export function useEditAllocation(planId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      allocationId,
      input,
    }: {
      allocationId: string;
      input: UpdateAllocationInput;
    }) =>
      (
        await apiClient.patch<SeatPlanAllocationRow>(
          `/seat-plans/${planId}/allocations/${allocationId}`,
          input,
        )
      ).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: seatPlanKeys.detail(planId) }),
  });
}

/** [25.7] step 4: re-run allocation for one room only (DRAFT only, D9). */
export function useReshuffleRoom(planId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (roomId: string) =>
      (await apiClient.post<SeatPlanDetail>(`/seat-plans/${planId}/rooms/${roomId}/reshuffle`))
        .data,
    onSuccess: (data) => queryClient.setQueryData(seatPlanKeys.detail(planId), data),
  });
}

/** [25.7] step 2: set or clear a room's invigilator. */
export function useUpdateInvigilator(planId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ roomId, input }: { roomId: string; input: UpdateInvigilatorInput }) =>
      (
        await apiClient.patch<SeatPlanDetail>(
          `/seat-plans/${planId}/rooms/${roomId}/invigilator`,
          input,
        )
      ).data,
    onSuccess: (data) => queryClient.setQueryData(seatPlanKeys.detail(planId), data),
  });
}

/** [25.7] step 5: publish — locks the plan's schedules/allocations. */
export function usePublishSeatPlan(planId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<SeatPlanDetail>(`/seat-plans/${planId}/publish`, {})).data,
    onSuccess: (data) => {
      queryClient.setQueryData(seatPlanKeys.detail(planId), data);
      void queryClient.invalidateQueries({ queryKey: seatPlanKeys.lists() });
    },
  });
}
