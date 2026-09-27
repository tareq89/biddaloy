import { LeaveType, LeaveStatus } from '@biddaloy/shared';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useCreateLeaveRequest, useLeaveBalance, useLeavePolicies } from './leave';

describe('useLeaveBalance', () => {
  it('resolves the balance the handler returns for the given staff profile', async () => {
    server.use(
      http.get('/api/v1/leave/balance', () =>
        HttpResponse.json([
          { leave_type: LeaveType.CASUAL, annual_quota_days: 10, used_days: 3, balance: 7 },
        ]),
      ),
    );

    const { result } = renderHookWithProviders(() => useLeaveBalance('profile-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.balance).toBe(7);
  });
});

describe('useLeavePolicies', () => {
  it('resolves the quota per leave type', async () => {
    server.use(
      http.get('/api/v1/leave/policies', () =>
        HttpResponse.json([{ leave_type: LeaveType.SICK, annual_quota_days: 14 }]),
      ),
    );

    const { result } = renderHookWithProviders(() => useLeavePolicies(), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toEqual({
      leave_type: LeaveType.SICK,
      annual_quota_days: 14,
    });
  });
});

describe('useCreateLeaveRequest', () => {
  it("posts the request and invalidates that staff profile's balance cache", async () => {
    server.use(
      http.post('/api/v1/leave/requests', () =>
        HttpResponse.json({
          id: 'record-1',
          staff_profile_id: 'profile-1',
          leave_type: LeaveType.CASUAL,
          start_date: '2026-10-01',
          end_date: '2026-10-02',
          days: 2,
          status: LeaveStatus.PENDING,
          reason: null,
          approved_by: null,
          decided_at: null,
        }),
      ),
    );

    const { result, queryClient } = renderHookWithProviders(() => useCreateLeaveRequest(), {
      tenantId: 'tenant-1',
    });
    queryClient.setQueryData(['leave', 'balance', 'profile-1'], [{ balance: 10 }]);

    result.current.mutate({
      staff_profile_id: 'profile-1',
      leave_type: LeaveType.CASUAL,
      start_date: '2026-10-01',
      end_date: '2026-10-02',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('record-1');
    expect(queryClient.getQueryState(['leave', 'balance', 'profile-1'])?.isInvalidated).toBe(true);
  });
});
