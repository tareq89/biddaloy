import { AttendanceStatus } from '@biddaloy/shared';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useMarkStaffAttendance, useStaffAttendanceSummary } from './staff-attendance';

describe('useStaffAttendanceSummary', () => {
  it('resolves the summary the handler returns for the given staff profile and range', async () => {
    server.use(
      http.get('/api/v1/staff-attendance/summary', () =>
        HttpResponse.json({
          working_days: 20,
          present_days: 18,
          late_days: 1,
          absent_days: 1,
          leave_days: 0,
          attendance_percentage: 90,
        }),
      ),
    );

    const { result } = renderHookWithProviders(
      () => useStaffAttendanceSummary('profile-1', '2026-09-01', '2026-09-30'),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.attendance_percentage).toBe(90);
  });

  it('does not fire a request for an empty staffProfileId', () => {
    let requested = false;
    server.use(
      http.get('/api/v1/staff-attendance/summary', () => {
        requested = true;
        return HttpResponse.json({});
      }),
    );

    const { result } = renderHookWithProviders(
      () => useStaffAttendanceSummary('', '2026-09-01', '2026-09-30'),
      { tenantId: 'tenant-1' },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(requested).toBe(false);
  });
});

describe('useMarkStaffAttendance', () => {
  it('marks a day and invalidates every open summary query', async () => {
    server.use(
      http.put('/api/v1/staff-attendance/register', () =>
        HttpResponse.json({
          date: '2026-09-27',
          session_id: 'session-1',
          version: 1,
          records: [
            {
              staff_profile_id: 'profile-1',
              record_id: 'record-1',
              status: AttendanceStatus.PRESENT,
            },
          ],
        }),
      ),
    );

    const { result, queryClient } = renderHookWithProviders(() => useMarkStaffAttendance(), {
      tenantId: 'tenant-1',
    });
    queryClient.setQueryData(['staff-attendance', 'summary', 'profile-1', 'x', 'y'], {});

    result.current.mutate({
      date: '2026-09-27',
      entries: [{ staff_profile_id: 'profile-1', status: AttendanceStatus.PRESENT }],
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.session_id).toBe('session-1');
    expect(
      queryClient.getQueryState(['staff-attendance', 'summary', 'profile-1', 'x', 'y'])
        ?.isInvalidated,
    ).toBe(true);
  });
});
