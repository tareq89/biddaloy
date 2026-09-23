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
