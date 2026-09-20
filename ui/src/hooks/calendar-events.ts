import type { CalendarAudience, CalendarEventType } from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import type { PublicHolidayEntry } from './public-holiday-sets';
import { shouldRetryQuery } from './retry';

// [17.4.2]: `CalendarEventResponseDto`/`CalendarEventListResponseDto` are
// real server DTOs (`server/src/modules/calendar/dto/calendar-events.dto
// .ts`) — `schema.d.ts` just hasn't been regenerated since this ticket's
// base branch merged them (this ticket's plan comment: codegen is the
// parent's step, deliberately not run here). Hand-typed here rather than
// left as `any` so every other file in this ticket still gets real
// type-checking; delete this block and switch back to
// `components['schemas'][...]` once codegen catches up.
export interface CalendarEvent {
  id: string;
  academic_year_id: string;
  type: CalendarEventType;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  counts_as_working_day: boolean;
  audience: CalendarAudience;
  class_ids: string[];
  is_locked: boolean;
  published: boolean;
}
export interface CalendarEventList {
  data: CalendarEvent[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
export type CreateCalendarEventInput = components['schemas']['CreateCalendarEventDto'];
export type UpdateCalendarEventInput = components['schemas']['UpdateCalendarEventDto'];
export type { PublicHolidayEntry };

export interface CalendarEventsFilters {
  from: string;
  to: string;
  types?: string[] | undefined;
  classId?: string | undefined;
  includeDrafts?: boolean | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

export const calendarEventKeys = {
  all: ['calendar-events'] as const,
  list: (filters: CalendarEventsFilters) => ['calendar-events', 'list', filters] as const,
  detail: (id: string) => ['calendar-events', 'detail', id] as const,
};

export const publicHolidayKeys = {
  suggest: (year: number) => ['calendar-public-holidays', 'suggest', year] as const,
};

/**
 * `GET /calendar/events?from&to&types&class_id&include_drafts&page&limit`
 * — the month grid / agenda's single data source. `from`/`to` are the
 * visible range (usually ±1 week around the month, so leading/trailing
 * days from neighbouring months render too).
 */
export function calendarEventsQueryOptions(filters: CalendarEventsFilters) {
  return queryOptions({
    queryKey: calendarEventKeys.list(filters),
    queryFn: async () => {
      const res = await apiClient.get<CalendarEventList>('/calendar/events', {
        params: {
          from: filters.from,
          to: filters.to,
          types: filters.types?.length ? filters.types.join(',') : undefined,
          class_id: filters.classId,
          include_drafts: filters.includeDrafts,
          page: filters.page ?? 1,
          limit: filters.limit ?? 100,
        },
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useCalendarEvents(filters: CalendarEventsFilters) {
  return useQuery(calendarEventsQueryOptions(filters));
}

export function useCalendarEvent(id: string | undefined) {
  return useQuery({
    queryKey: calendarEventKeys.detail(id ?? ''),
    queryFn: async () => {
      const res = await apiClient.get<CalendarEvent>(`/calendar/events/${id}`);
      return res.data;
    },
    enabled: id !== undefined,
    retry: shouldRetryQuery,
  });
}

export function useCreateCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCalendarEventInput) => {
      const res = await apiClient.post<CalendarEvent>('/calendar/events', input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: calendarEventKeys.all });
    },
  });
}

export function useUpdateCalendarEvent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateCalendarEventInput) => {
      const res = await apiClient.patch<CalendarEvent>(`/calendar/events/${id}`, input);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: calendarEventKeys.all });
    },
  });
}

export function useDeleteCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/calendar/events/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: calendarEventKeys.all });
    },
  });
}

export function usePublishCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<CalendarEvent>(`/calendar/events/${id}/publish`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: calendarEventKeys.all });
    },
  });
}

/** `GET /calendar/public-holidays?year=` — suggested holidays for the
 * tenant's country/year, from a published platform holiday set. */
export function usePublicHolidaySuggestions(year: number) {
  return useQuery({
    queryKey: publicHolidayKeys.suggest(year),
    queryFn: async () => {
      const res = await apiClient.get<PublicHolidayEntry[]>('/calendar/public-holidays', {
        params: { year },
      });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

/** `POST /calendar/public-holidays/add` — bulk-add ticked suggestions as
 * HOLIDAY events on this tenant. */
export function useAddPublicHolidays() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entryIds: string[]) => {
      const res = await apiClient.post<CalendarEvent[]>('/calendar/public-holidays/add', {
        entry_ids: entryIds,
      });
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: calendarEventKeys.all });
    },
  });
}
