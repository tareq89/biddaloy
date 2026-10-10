import { useQuery, queryOptions } from '@tanstack/react-query';

import { apiClient } from './client';
import type { components } from './schema';

/**
 * [36.4/#1102] Typed hooks over `GET /leave/balance` and `GET /leave/policies`.
 * Requesting and deciding leave go through applications (D20), not here.
 */

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
