import { AttendanceStatus } from '@biddaloy/shared';
import { useMutation, useQuery, useQueryClient, queryOptions } from '@tanstack/react-query';

import { apiClient } from './client';

/**
 * [36.4] Typed hooks over `PUT /staff-attendance/register` and
 * `GET /staff-attendance/summary` — `schema.d.ts` isn't regenerated for
 * this ticket (that's #1102's job at epic close), so these shapes are
 * hand-typed against `server/src/modules/staff-attendance/dto/
 * staff-attendance.dto.ts` directly, same gap-handling `guardians.ts`'s
 * `PaginatedGuardians` and Epic 23.0's staff-document upload hooks
 * document for themselves. Mirrors `ui/src/hooks/users.ts`'s
 * `useQuery`/`useMutation` shape.
 */

export interface StaffAttendanceEntry {
  staff_profile_id: string;
  status: AttendanceStatus;
}

export interface PutStaffAttendanceRegisterInput {
  date: string;
  /** Required only when correcting an already-marked day outside the
   * tenant's correction window — server 400s without it in that case. */
  reason?: string;
  entries: StaffAttendanceEntry[];
}

export interface StaffAttendanceRecord {
  staff_profile_id: string;
  record_id: string;
  status: AttendanceStatus;
}

export interface StaffAttendanceRegisterResponse {
  date: string;
  session_id: string;
  version: number;
  records: StaffAttendanceRecord[];
}

export interface StaffAttendanceSummary {
  working_days: number;
  present_days: number;
  late_days: number;
  absent_days: number;
  leave_days: number;
  attendance_percentage: number | null;
}

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
    },
  });
}
