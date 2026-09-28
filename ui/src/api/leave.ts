import { useMutation, useQuery, useQueryClient, queryOptions } from '@tanstack/react-query';

import { apiClient } from './client';
import type { components } from './schema';

/**
 * [36.4/#1102] Typed hooks over `POST /leave/requests`, `GET /leave/balance`
 * and `GET /leave/policies` — shapes come from the regenerated `schema.d.ts`
 * now, not hand-typed interfaces.
 *
 * No `GET /leave/requests` (list) exists on the server yet, so there is no
 * hook here for a pending-requests list or a `decide` mutation — both
 * would need a record id this client has no way to obtain. See
 * `-leave-approve-list.tsx`'s own comment for how the approve panel
 * handles that gap.
 */

export type CreateLeaveRequestInput = components['schemas']['CreateLeaveRequestDto'];
export type LeaveRecord = components['schemas']['LeaveRecordDto'];
export type LeaveBalance = components['schemas']['LeaveBalanceDto'];

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
      const res = await apiClient.get<components['schemas']['LeavePolicyDto'][]>(
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
