import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { shouldRetryQuery } from './retry';

export type CalendarSettings = components['schemas']['CalendarSettingsResponseDto'];

export const calendarSettingsKeys = {
  all: ['calendar-settings'] as const,
};

/**
 * `GET /calendar-settings` — read-only composite (term label, region,
 * week shape, current academic year). Writes go through
 * `useUpdateSchoolSettings` (`region.country`, `region.calendar.termLabel`)
 * — see `calendar-settings.dto.ts`'s own docstring on `CalendarSettingsResponseDto`.
 */
export function calendarSettingsQueryOptions() {
  return queryOptions({
    queryKey: calendarSettingsKeys.all,
    queryFn: async () => {
      const res = await apiClient.get<CalendarSettings>('/calendar-settings');
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useCalendarSettings() {
  return useQuery(calendarSettingsQueryOptions());
}
