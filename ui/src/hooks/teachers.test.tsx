import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { teacherFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useCreateTeacher, useTeachers, useUpdateTeacher } from './teachers';

describe('useTeachers', () => {
  it('sends search and user_id as query params', async () => {
    let params: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/teachers', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => useTeachers({ search: 'Karim', user_id: 'user-1' }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(params!.get('search')).toBe('Karim');
    expect(params!.get('user_id')).toBe('user-1');
  });

  it('resolves with the teacher list', async () => {
    const teacher = teacherFactory({ employee_id: 'EMP-00001' });
    server.use(
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({ data: [teacher], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { result } = renderHookWithProviders(() => useTeachers({}), { tenantId: 'tenant-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data[0]?.employee_id).toBe('EMP-00001');
  });
});

describe('useCreateTeacher (promote a member)', () => {
  it('POSTs the exact promotion body', async () => {
    let body: unknown = null;
    server.use(
      http.post('/api/v1/teachers', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(teacherFactory(), { status: 201 });
      }),
    );

    const { result } = renderHookWithProviders(() => useCreateTeacher(), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({
      user_id: 'user-1',
      employee_id: 'EMP-42',
      designations: ['CLASS_TEACHER', 'COORDINATOR'],
      subject_specialization: 'Mathematics',
      joining_date: '2026-01-15',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({
      user_id: 'user-1',
      employee_id: 'EMP-42',
      designations: ['CLASS_TEACHER', 'COORDINATOR'],
      subject_specialization: 'Mathematics',
      joining_date: '2026-01-15',
    });
  });

  it('surfaces the 409 duplicate-employee-id as an error', async () => {
    server.use(
      http.post('/api/v1/teachers', () =>
        HttpResponse.json({ statusCode: 409, message: 'exists' }, { status: 409 }),
      ),
    );

    const { result } = renderHookWithProviders(() => useCreateTeacher(), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({ user_id: 'user-1', employee_id: 'EMP-42' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUpdateTeacher', () => {
  it('PATCHes the teacher profile', async () => {
    let body: unknown = null;
    server.use(
      http.patch('/api/v1/teachers/:id', async ({ params, request }) => {
        body = await request.json();
        return HttpResponse.json(teacherFactory({ id: params.id as string }));
      }),
    );

    const { result } = renderHookWithProviders(() => useUpdateTeacher('teacher-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({ employee_id: 'EMP-43', designations: ['HEAD_TEACHER'] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ employee_id: 'EMP-43', designations: ['HEAD_TEACHER'] });
  });
});
