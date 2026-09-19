import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';

import { shouldRetryQuery } from './retry';

// [17.4.3]: `GET /calendar/feed` and `POST /calendar/feed/regenerate`
// don't exist on the server yet — #718 (the ICS export feed itself) is a
// separate sub-issue and this ticket's plan explicitly does not block on
// it (see this ticket's `## Plan — 719` comment). Hand-typed here, same
// idiom `calendar-events.ts` uses for `CalendarEvent`/`CalendarEventList`,
// so this file and everything built on it still type-checks; swap for
// `components['schemas'][...]` from `../api/schema` once #718 ships and
// `schema.d.ts` is regenerated with the real DTOs.
export interface CalendarFeed {
  /** A `webcal://` URL carrying the caller's own feed token. */
  url: string;
}

export const calendarFeedKeys = {
  detail: ['calendar-feed'] as const,
};

/**
 * `GET /calendar/feed` — the signed-in user's personal ICS subscribe
 * link. Lazy: only fetched once `calendar-feed-card.tsx` mounts (it's
 * behind `CALENDAR_READ` and hidden entirely otherwise), never preloaded
 * with the rest of the security/account route data.
 */
export function useCalendarFeed() {
  return useQuery({
    queryKey: calendarFeedKeys.detail,
    queryFn: async () => {
      const res = await apiClient.get<CalendarFeed>('/calendar/feed');
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

/**
 * `POST /calendar/feed/regenerate` — invalidates the old token server-side
 * and returns a fresh URL, which replaces the cached `GET /calendar/feed`
 * value directly rather than triggering a refetch (there's nothing left
 * to refetch from — the old link the cache held is now dead).
 */
export function useRegenerateCalendarFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<CalendarFeed>('/calendar/feed/regenerate');
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(calendarFeedKeys.detail, data);
    },
  });
}
