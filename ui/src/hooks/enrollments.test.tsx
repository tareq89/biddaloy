import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  enrollmentKeys,
  useCreateEnrollment,
  useCurrentEnrollment,
  useStudentEnrollments,
  useUpdateEnrollment,
} from './enrollments';
import { studentKeys } from './students';

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

describe('useCurrentEnrollment', () => {
  it("[8.11.3] resolves the Move class dialog's starting point — the student's ACTIVE row", async () => {
    server.use(
      http.get('/api/v1/enrollments/:studentId/current', () =>
        HttpResponse.json({
          id: 'enrollment-1',
          student_id: 'student-1',
          enrollment_status: 'ACTIVE',
        }),
      ),
    );

    const { result } = renderHookWithProviders(() => useCurrentEnrollment('student-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('enrollment-1');
  });

  it('resolves null for a legacy student with no ACTIVE enrollment row yet — the get-or-create branch', async () => {
    server.use(http.get('/api/v1/enrollments/:studentId/current', () => HttpResponse.json(null)));

    const { result } = renderHookWithProviders(() => useCurrentEnrollment('student-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe('useCreateEnrollment', () => {
  it("[8.11.3] the get-or-create fallback POST — invalidates the student's enrollment history and detail", async () => {
    server.use(
      http.post('/api/v1/enrollments', async ({ request }) => {
        const body = (await request.json()) as { student_id: string; class_id: string };
        return HttpResponse.json(
          {
            id: 'enrollment-new',
            student_id: body.student_id,
            class_id: body.class_id,
            enrollment_status: 'ACTIVE',
          },
          { status: 201 },
        );
      }),
    );

    const { result, queryClient } = renderHookWithProviders(() => useCreateEnrollment(), {
      tenantId: 'tenant-1',
      seedQueries: [
        { queryKey: enrollmentKeys.list({ studentId: 'student-1' }), data: [] },
        { queryKey: studentKeys.detail('student-1'), data: { id: 'student-1' } },
      ],
    });

    result.current.mutate({
      student_id: 'student-1',
      class_id: 'class-1',
      section_id: 'section-1',
      academic_year_id: 'ay-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('enrollment-new');

    // The move changes Student.class_section_id/roll_number too, not just
    // enrollment history — both query families must be invalidated, not
    // just the one the mutation directly wrote to.
    expect(
      queryClient.getQueryState(enrollmentKeys.list({ studentId: 'student-1' }))?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(studentKeys.detail('student-1'))?.isInvalidated).toBe(true);
  });
});

describe('useUpdateEnrollment', () => {
  it('[8.11.3] the primary PATCH path — invalidates enrollment history and student detail on success', async () => {
    server.use(
      http.patch('/api/v1/enrollments/:id', async ({ params, request }) => {
        const body = (await request.json()) as { class_id?: string; section_id?: string };
        return HttpResponse.json({
          id: params.id,
          student_id: 'student-1',
          class_id: body.class_id,
          section_id: body.section_id,
          enrollment_status: 'ACTIVE',
        });
      }),
    );

    const { result, queryClient } = renderHookWithProviders(
      () => useUpdateEnrollment('enrollment-1'),
      {
        tenantId: 'tenant-1',
        seedQueries: [
          { queryKey: enrollmentKeys.list({ studentId: 'student-1' }), data: [] },
          { queryKey: studentKeys.detail('student-1'), data: { id: 'student-1' } },
        ],
      },
    );

    result.current.mutate({ class_id: 'class-2', section_id: 'section-2' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.class_id).toBe('class-2');

    expect(
      queryClient.getQueryState(enrollmentKeys.list({ studentId: 'student-1' }))?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(studentKeys.detail('student-1'))?.isInvalidated).toBe(true);
  });

  it('surfaces a validation error (e.g. class_id without section_id) via isError, not a thrown exception', async () => {
    server.use(
      http.patch('/api/v1/enrollments/:id', () =>
        HttpResponse.json(
          apiErrorBody(
            400,
            'section_id is required when changing class_id',
            '/api/v1/enrollments/enrollment-1',
          ),
          { status: 400 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useUpdateEnrollment('enrollment-1'), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({ class_id: 'class-2' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
