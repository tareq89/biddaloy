import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { sectionStreaksKey, useAttendanceStreaks } from './attendance';
import { myClassKeys, useMyClassSections } from './my-class';

describe('useMyClassSections', () => {
  it('resolves the sections with a role each', async () => {
    server.use(
      http.get('/api/v1/my-class/sections', () =>
        HttpResponse.json([
          {
            section_id: 's1',
            section_name: 'A',
            class_id: 'c1',
            class_name: 'Class 5',
            assignment_type: 'CLASS_TEACHER',
          },
        ]),
      ),
    );
    const { result } = renderHookWithProviders(() => useMyClassSections(), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.assignment_type).toBe('CLASS_TEACHER');
    expect(myClassKeys.list()).toEqual(['my-class', 'list', {}]);
  });
});

describe('useAttendanceStreaks', () => {
  it('resolves streaks for a section', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/s1/streaks', () =>
        HttpResponse.json({
          items: [
            {
              student_id: 'st1',
              student_name: 'Rahim',
              roll_number: 1,
              status: 'ABSENT',
              length: 3,
              since_date: '2026-10-01',
            },
          ],
          as_of_date: '2026-10-03',
        }),
      ),
    );
    const { result } = renderHookWithProviders(() => useAttendanceStreaks('s1'), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.length).toBe(3);
    expect(sectionStreaksKey('s1')).toEqual(['attendance', 'streaks', 's1']);
  });

  it('stays idle without a sectionId', () => {
    const { result } = renderHookWithProviders(() => useAttendanceStreaks(undefined), {
      tenantId: 'tenant-1',
    });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
