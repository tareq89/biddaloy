import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/**
 * [17.3.5/#715] Platform public-holiday sets — SUPER_ADMIN maintains the
 * per-country lists schools import (`/platform/holiday-sets/*`,
 * `server/src/modules/calendar/public-holidays.controller.ts`). Reuses
 * `schema.d.ts`'s generated `PublicHolidaySet`/`PublicHolidayEntry`
 * shapes directly (#708 already regenerated it — see `schema.d.ts:4694`)
 * rather than hand-typing, unlike `school-settings.ts`'s several
 * not-yet-regenerated gaps.
 */
export type PublicHolidaySet = components['schemas']['PublicHolidaySet'];
export type PublicHolidayEntry = components['schemas']['PublicHolidayEntry'];
export type HolidayEntryInput = components['schemas']['HolidayEntryInputDto'];
export type FetchHolidaySetInput = components['schemas']['FetchHolidaySetDto'];

export const publicHolidaySetKeys = createEntityKeys<never, string>('public-holiday-sets');

export function publicHolidaySetsQueryOptions() {
  return queryOptions({
    queryKey: publicHolidaySetKeys.lists(),
    queryFn: async () => (await apiClient.get<PublicHolidaySet[]>('/platform/holiday-sets')).data,
    retry: shouldRetryQuery,
  });
}

export function useHolidaySets() {
  return useQuery(publicHolidaySetsQueryOptions());
}

export function publicHolidaySetQueryOptions(id: string) {
  return queryOptions({
    queryKey: publicHolidaySetKeys.detail(id),
    queryFn: async () =>
      (await apiClient.get<PublicHolidaySet>(`/platform/holiday-sets/${id}`)).data,
    enabled: Boolean(id),
    retry: shouldRetryQuery,
  });
}

export function useHolidaySet(id: string) {
  return useQuery(publicHolidaySetQueryOptions(id));
}

/** Fetches (or re-fetches) a country/year set from the external source
 * (`NAGER_DATE` primary, `GOOGLE_ICS` fallback — see the controller's own
 * doc comment). Invalidates the list on success so a newly-fetched set
 * shows up without a manual refresh. */
export function useFetchHolidaySet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FetchHolidaySetInput) =>
      (await apiClient.post<PublicHolidaySet>('/platform/holiday-sets/fetch', input)).data,
    onSuccess: (set) => {
      queryClient.setQueryData(publicHolidaySetKeys.detail(set.id), set);
      void queryClient.invalidateQueries({ queryKey: publicHolidaySetKeys.lists() });
    },
  });
}

/** Replaces a set's full entry list (`PUT .../entries`) — the detail
 * page's Save always sends the complete array, same "no partial patch"
 * shape the server DTO expects (`UpdateHolidaySetEntriesDto`). */
export function useUpdateHolidaySetEntries(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entries: HolidayEntryInput[]) =>
      (await apiClient.put<PublicHolidaySet>(`/platform/holiday-sets/${id}/entries`, { entries }))
        .data,
    onSuccess: (set) => {
      queryClient.setQueryData(publicHolidaySetKeys.detail(id), set);
      void queryClient.invalidateQueries({ queryKey: publicHolidaySetKeys.lists() });
    },
  });
}

export function usePublishHolidaySet(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<PublicHolidaySet>(`/platform/holiday-sets/${id}/publish`)).data,
    onSuccess: (set) => {
      queryClient.setQueryData(publicHolidaySetKeys.detail(id), set);
      void queryClient.invalidateQueries({ queryKey: publicHolidaySetKeys.lists() });
    },
  });
}

export function useUnpublishHolidaySet(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<PublicHolidaySet>(`/platform/holiday-sets/${id}/unpublish`)).data,
    onSuccess: (set) => {
      queryClient.setQueryData(publicHolidaySetKeys.detail(id), set);
      void queryClient.invalidateQueries({ queryKey: publicHolidaySetKeys.lists() });
    },
  });
}
