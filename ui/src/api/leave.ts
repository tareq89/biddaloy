import { LeaveType, LeaveStatus } from '@biddaloy/shared';
import { useMutation, useQuery, useQueryClient, queryOptions } from '@tanstack/react-query';

import { apiClient } from './client';

/**
 * [36.4] Typed hooks over `POST /leave/requests`, `GET /leave/balance` and
 * `GET /leave/policies` — hand-typed against `server/src/modules/leave/
 * dto/leave.dto.ts` for the same "schema.d.ts not regenerated yet" reason
 * `staff-attendance.ts` documents.
 *
 * No `GET /leave/requests` (list) exists on the server yet, so there is no
 * hook here for a pending-requests list or a `decide` mutation — both
 * would need a record id this client has no way to obtain. See
 * `-leave-approve-list.tsx`'s own comment for how the approve panel
 * handles that gap.
 */

export interface CreateLeaveRequestInput {
  staff_profile_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason?: string;
}

export interface LeaveRecord {
  id: string;
  staff_profile_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days: number;
  status: LeaveStatus;
  reason: string | null;
  approved_by: string | null;
  decided_at: string | null;
}

export interface LeaveBalance {
  leave_type: LeaveType;
  annual_quota_days: number;
  used_days: number;
  balance: number;
}

export function leaveBalanceQueryOptions(staffProfileId: string) {
  return queryOptions({
    queryKey: ['leave', 'balance', staffProfileId] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<LeaveBalance[]>('/leave/balance', {
        params: { staff_profile_id: staffProfileId },
        signal,
      });
      return res.data;
    },
    enabled: staffProfileId !== '',
  });
}

export function useLeaveBalance(staffProfileId: string) {
  return useQuery(leaveBalanceQueryOptions(staffProfileId));
}

export function useLeavePolicies() {
  return useQuery({
    queryKey: ['leave', 'policies'] as const,
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<{ leave_type: LeaveType; annual_quota_days: number }[]>(
        '/leave/policies',
        { signal },
      );
      return res.data;
    },
  });
}

/** [36.4] Requests leave for `input.staff_profile_id` — server rejects
 * (400/409, surfaced via `ApiError.message`) when it would exceed that
 * leave type's remaining balance for the year. */
export function useCreateLeaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateLeaveRequestInput) => {
      const res = await apiClient.post<LeaveRecord>('/leave/requests', input);
      return res.data;
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: ['leave', 'balance', input.staff_profile_id],
      });
    },
  });
}
