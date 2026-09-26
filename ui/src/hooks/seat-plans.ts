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
