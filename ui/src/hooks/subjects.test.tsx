import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { classSubjectFactory, subjectFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import {
  subjectKeys,
  useAttachClassSubject,
  useClassSubjects,
  useCreateSubject,
  useDeleteSubject,
  useDetachClassSubject,
  useSubjects,
  useUpdateSubject,
} from './subjects';

describe('useSubjects resolves the tenant subject list', () => {
  it('resolves subject handler returns', async () => {
    const subjects = [
      subjectFactory({ name_en: 'Mathematics' }),
      subjectFactory({ name_en: 'Bangla' }),
    ];
    server.use(
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: subjects, total: 2, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    const { result } = renderHookWithProviders(() => useSubjects(), { tenantId: 'tenant-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.map((s) => s.name_en)).toEqual(['Mathematics', 'Bangla']);
  });
});

describe('useClassSubjects', () => {
  it('lists subjects a class offers in an academic year', async () => {
    const classSubjects = [
      classSubjectFactory({ subject: subjectFactory({ name_en: 'Mathematics' }) }),
    ];
    server.use(
      http.get('/api/v1/classes/:classId/subjects', () => HttpResponse.json(classSubjects)),
    );

    const { result } = renderHookWithProviders(() => useClassSubjects('class-1', 'year-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((cs) => cs.subject.name_en)).toEqual(['Mathematics']);
  });

  it('stays disabled and issues no request when classId is undefined', () => {
    let requested = false;
    server.use(
      http.get('/api/v1/classes/:classId/subjects', () => {
        requested = true;
        return HttpResponse.json([]);
      }),
    );

    const { result } = renderHookWithProviders(() => useClassSubjects(undefined, 'year-1'), {
      tenantId: 'tenant-1',
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(requested).toBe(false);
  });

  it('stays disabled when academicYearId is undefined', () => {
    let requested = false;
    server.use(
      http.get('/api/v1/classes/:classId/subjects', () => {
        requested = true;
        return HttpResponse.json([]);
      }),
    );

    const { result } = renderHookWithProviders(() => useClassSubjects('class-1', undefined), {
      tenantId: 'tenant-1',
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(requested).toBe(false);
  });
});

describe('useCreateSubject invalidates the subject list', () => {
  it('a created subject shows up in the next list read', async () => {
    let subjects = [subjectFactory({ name_en: 'Mathematics' })];
    server.use(
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({
          data: subjects,
          total: subjects.length,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.post('/api/v1/subjects', async ({ request }) => {
        const body = (await request.json()) as { name_en: string; code: string };
        const created = subjectFactory({ name_en: body.name_en, code: body.code });
        subjects = [...subjects, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => ({ list: useSubjects(), create: useCreateSubject() }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(result.current.list.data?.data).toHaveLength(1);

    result.current.create.mutate({ name_en: 'Bangla', code: 'BAN' });

    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.list.data?.data).toHaveLength(2));
  });
});

describe('useUpdateSubject', () => {
  it('invalidates the detail and list caches on success', async () => {
    const queryClient = createTestQueryClient();
    server.use(
      http.patch('/api/v1/subjects/:id', async ({ request }) => {
        const body = (await request.json()) as { name_en: string };
        return HttpResponse.json(subjectFactory({ id: 'subject-1', name_en: body.name_en }));
      }),
    );

    const { result } = renderHookWithProviders(() => useUpdateSubject('subject-1'), {
      tenantId: 'tenant-1',
      queryClient,
    });

    result.current.mutate({ name_en: 'Renamed' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name_en).toBe('Renamed');
  });
});

describe('useDeleteSubject', () => {
  it('removes cached detail and invalidates the list variant', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(subjectKeys.detail('subject-1'), subjectFactory({ id: 'subject-1' }));

    let deleteCalledWith: string | null = null;
    server.use(
      http.delete('/api/v1/subjects/:id', ({ params }) => {
        deleteCalledWith = params.id as string;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const { result } = renderHookWithProviders(() => useDeleteSubject(), {
      tenantId: 'tenant-1',
      queryClient,
    });

    result.current.mutate('subject-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteCalledWith).toBe('subject-1');
    expect(queryClient.getQueryData(subjectKeys.detail('subject-1'))).toBeUndefined();
  });
});

describe('useAttachClassSubject / useDetachClassSubject invalidate the class-subjects list', () => {
  it('an attached subject shows up in the next class-subjects read', async () => {
    let classSubjects: ReturnType<typeof classSubjectFactory>[] = [];
    server.use(
      http.get('/api/v1/classes/:classId/subjects', () => HttpResponse.json(classSubjects)),
      http.post('/api/v1/classes/:classId/subjects', () => {
        const created = classSubjectFactory();
        classSubjects = [...classSubjects, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => ({
        list: useClassSubjects('class-1', 'year-1'),
        attach: useAttachClassSubject('class-1', 'year-1'),
      }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(result.current.list.data).toHaveLength(0);

    result.current.attach.mutate({ subject_id: 'subject-1', academic_year_id: 'year-1' });

    await waitFor(() => expect(result.current.attach.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.list.data).toHaveLength(1));
  });

  it('a detached subject drops out of the next class-subjects read', async () => {
    let classSubjects = [classSubjectFactory({ subject_id: 'subject-1' })];
    server.use(
      http.get('/api/v1/classes/:classId/subjects', () => HttpResponse.json(classSubjects)),
      http.delete('/api/v1/classes/:classId/subjects/:subjectId', ({ params }) => {
        classSubjects = classSubjects.filter((cs) => cs.subject_id !== params.subjectId);
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => ({
        list: useClassSubjects('class-1', 'year-1'),
        detach: useDetachClassSubject('class-1', 'year-1'),
      }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.list.data).toHaveLength(1));

    result.current.detach.mutate('subject-1');

    await waitFor(() => expect(result.current.detach.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.list.data).toHaveLength(0));
  });
});
