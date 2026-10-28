import { useMutation, useQuery, useQueryClient, queryOptions } from '@tanstack/react-query';

import { apiClient } from './client';
import type { components } from './schema';

/**
 * [36.4/#1102] Typed hooks over `PUT /staff-attendance/register` and
 * `GET /staff-attendance/summary` — shapes come from the regenerated
 * `schema.d.ts` now, not hand-typed interfaces. Mirrors
 * `ui/src/hooks/users.ts`'s `useQuery`/`useMutation` shape.
 */

export type StaffAttendanceEntry = components['schemas']['StaffAttendanceEntryDto'];
export type PutStaffAttendanceRegisterInput =
  components['schemas']['PutStaffAttendanceRegisterDto'];
export type StaffAttendanceRecord = components['schemas']['StaffAttendanceRecordDto'];
export type StaffAttendanceRegisterResponse =
  components['schemas']['StaffAttendanceRegisterResponseDto'];
export type StaffAttendanceRosterRow = components['schemas']['StaffAttendanceRosterRowDto'];
export type StaffAttendanceDay = components['schemas']['StaffAttendanceDayDto'];
export type StaffAttendanceSummary = components['schemas']['StaffAttendanceSummaryDto'];

export function staffAttendanceSummaryQueryOptions(
  staffProfileId: string,
  from: string,
  to: string,
) {
  return queryOptions({
    queryKey: ['staff-attendance', 'summary', staffProfileId, from, to] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StaffAttendanceSummary>('/staff-attendance/summary', {
        params: { staff_profile_id: staffProfileId, from, to },
        signal,
      });
      return res.data;
    },
    enabled: staffProfileId !== '',
  });
}

export function useStaffAttendanceSummary(staffProfileId: string, from: string, to: string) {
  return useQuery(staffAttendanceSummaryQueryOptions(staffProfileId, from, to));
}

const DAY_KEY = ['staff-attendance', 'day'] as const;

/** The roster the caller may mark on `date`, with that day's saved marks. */
export function staffAttendanceDayQueryOptions(date: string) {
  return queryOptions({
    queryKey: [...DAY_KEY, date] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<StaffAttendanceDay>('/staff-attendance/register', {
        params: { date },
        signal,
      });
      return res.data;
    },
  });
}

export function useStaffAttendanceDay(date: string) {
  return useQuery(staffAttendanceDayQueryOptions(date));
}

/** Marks/corrects one day's staff attendance in one call. Invalidates
 * every open summary query — a summary's date range is arbitrary, so
 * there is no single key to target the way `userKeys.detail(id)` can. */
export function useMarkStaffAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PutStaffAttendanceRegisterInput) => {
      const res = await apiClient.put<StaffAttendanceRegisterResponse>(
        '/staff-attendance/register',
        input,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff-attendance', 'summary'] });
      void queryClient.invalidateQueries({ queryKey: DAY_KEY });
    },
  });
}
