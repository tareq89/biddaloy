import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useStudentEnrollments } from './enrollments';

describe('useStudentEnrollments', () => {
  it("[8.10.2] resolves the Enrollment tab's history for one student", async () => {
    server.use(
      http.get('/api/v1/enrollments/student/:studentId', () =>
        HttpResponse.json([{ id: 'enrollment-1', enrollment_status: 'ACTIVE' }]),
      ),
    );

    const { result } = renderHookWithProviders(() => useStudentEnrollments('student-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('surfaces a 403 (a PARENT-scoped session hitting a staff-only endpoint) via isError, not a thrown exception', async () => {
    server.use(
      http.get('/api/v1/enrollments/student/:studentId', () =>
        HttpResponse.json(apiErrorBody(403, 'Forbidden', '/api/v1/enrollments/student/student-1'), {
          status: 403,
        }),
      ),
    );

    const { result } = renderHookWithProviders(() => useStudentEnrollments('student-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
