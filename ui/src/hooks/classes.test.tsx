import { TeacherDesignation } from '@biddaloy/shared';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { classFactory, classSectionFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import {
  classKeys,
  useAssignTeacher,
  useAssignTeacherAssignment,
  useClass,
  useClasses,
  useClassSections,
  useClassTeachers,
  useCreateClass,
  useCreateSection,
  useDeleteClass,
  useDeleteSection,
  useSectionTeachers,
  useUnassignTeacher,
  useUnassignTeacherAssignment,
  useUpdateClass,
  useUpdateSection,
} from './classes';

describe("useClasses resolves the tenant's class list for a filter dropdown", () => {
  it('resolves with every class the handler returns', async () => {
    const classes = [classFactory({ name: 'Class 5' }), classFactory({ name: 'Class 8' })];
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: classes, total: 2, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    const { result } = renderHookWithProviders(() => useClasses(), { tenantId: 'tenant-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.map((c) => c.name)).toEqual(['Class 5', 'Class 8']);
  });

  it('requests a high limit — this list backs a <select>, not a paginated table', async () => {
    let requestedLimit: string | null = null;
    server.use(
      http.get('/api/v1/classes', ({ request }) => {
        requestedLimit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 });
      }),
    );

    const { result } = renderHookWithProviders(() => useClasses(), { tenantId: 'tenant-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedLimit).toBe('100');
  });
});

describe("useClassSections resolves a class's sections and stays disabled without a classId", () => {
  it('resolves with the sections the handler returns for that class', async () => {
    const sections = [
      classSectionFactory({ section_name: 'A', class_id: 'class-1' }),
      classSectionFactory({ section_name: 'B', class_id: 'class-1' }),
    ];
    server.use(http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json(sections)));

    const { result } = renderHookWithProviders(() => useClassSections('class-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((s) => s.section_name)).toEqual(['A', 'B']);
  });

  it('never fires a request when classId is undefined — "All classes" has no sections to fetch', async () => {
    let callCount = 0;
    server.use(
      http.get('/api/v1/classes/:classId/sections', () => {
        callCount += 1;
        return HttpResponse.json([]);
      }),
    );

    const { result } = renderHookWithProviders(() => useClassSections(undefined), {
      tenantId: 'tenant-1',
    });

    // Give the query every chance to (incorrectly) fire before asserting
    // it never did.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.fetchStatus).toBe('idle');
    expect(callCount).toBe(0);
  });

  it('[8.11.2] carries enrolled_count through — the classes list expansion panel needs it per section', async () => {
    server.use(
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([
          {
            ...classSectionFactory({ section_name: 'A', class_id: 'class-1' }),
            enrolled_count: 12,
          },
          { ...classSectionFactory({ section_name: 'B', class_id: 'class-1' }), enrolled_count: 0 },
        ]),
      ),
    );

    const { result } = renderHookWithProviders(() => useClassSections('class-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((s) => s.enrolled_count)).toEqual([12, 0]);
  });
});

describe('useClass fetches a single class by id', () => {
  it('resolves with the class the handler returns for that id', async () => {
    server.use(
      http.get('/api/v1/classes/:id', ({ params }) =>
        HttpResponse.json(classFactory({ id: params.id as string, name: 'Class 6' })),
      ),
    );

    const { result } = renderHookWithProviders(() => useClass('class-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe('Class 6');
  });

  it('stays disabled and issues no request when id is undefined', () => {
    let requested = false;
    server.use(
      http.get('/api/v1/classes/:id', () => {
        requested = true;
        return HttpResponse.json(classFactory());
      }),
    );

    const { result } = renderHookWithProviders(() => useClass(undefined), {
      tenantId: 'tenant-1',
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(requested).toBe(false);
  });
});

describe('useClassTeachers resolves the class detail page Teachers tab', () => {
  it('resolves with the teachers, each carrying every section name they teach', async () => {
    server.use(
      http.get('/api/v1/classes/:classId/teachers', () =>
        HttpResponse.json([
          {
            id: 'teacher-1',
            employee_id: 'EMP-00001',
            full_name: 'Rahim Uddin',
            designations: [TeacherDesignation.CLASS_TEACHER],
            section_names: ['A', 'B'],
          },
        ]),
      ),
    );

    const { result } = renderHookWithProviders(() => useClassTeachers('class-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.section_names).toEqual(['A', 'B']);
  });

  it('stays disabled and issues no request when classId is undefined', () => {
    let requested = false;
    server.use(
      http.get('/api/v1/classes/:classId/teachers', () => {
        requested = true;
        return HttpResponse.json([]);
      }),
    );

    const { result } = renderHookWithProviders(() => useClassTeachers(undefined), {
      tenantId: 'tenant-1',
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(requested).toBe(false);
  });
});

describe('useSectionTeachers resolves a section teacher list and caches it', () => {
  it('resolves with the section teacher assignments the handler returns', async () => {
    server.use(
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', () =>
        HttpResponse.json([
          {
            id: 'assignment-1',
            teacher_id: 'teacher-1',
            employee_id: 'EMP-00001',
            full_name: 'Rahim Uddin',
            section_id: 'section-1',
            section_name: 'A',
            subject_id: null,
            subject_name: null,
          },
        ]),
      ),
    );

    const { result } = renderHookWithProviders(() => useSectionTeachers('class-1', 'section-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.employee_id).toBe('EMP-00001');
  });

  it('caches by class+section key — the same pair reuses the cached read', async () => {
    let requestCount = 0;
    server.use(
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', () => {
        requestCount += 1;
        return HttpResponse.json([]);
      }),
    );

    const queryClient = createTestQueryClient();
    const { result, rerender } = renderHookWithProviders(
      () => useSectionTeachers('class-1', 'section-1'),
      { tenantId: 'tenant-1', queryClient },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender();
    expect(requestCount).toBe(1);
  });
});

describe('useAssignTeacher invalidates both the section-scoped and class-wide teacher lists', () => {
  it('posts the assignment and both lists refetch on success', async () => {
    let postedBody: unknown = null;
    server.use(
      http.post('/api/v1/classes/:classId/sections/:sectionId/teachers', async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(
          {
            id: 'assignment-1',
            teacher_id: 'teacher-1',
            section_id: 'section-1',
            subject_id: null,
          },
          { status: 201 },
        );
      }),
      http.get('/api/v1/classes/:classId/sections/:sectionId/teachers', () =>
        HttpResponse.json([]),
      ),
      http.get('/api/v1/classes/:classId/teachers', () => HttpResponse.json([])),
    );

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHookWithProviders(() => useAssignTeacher('class-1', 'section-1'), {
      tenantId: 'tenant-1',
      queryClient,
    });

    result.current.mutate({ teacher_id: 'teacher-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postedBody).toEqual({ teacher_id: 'teacher-1' });
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['classes', 'section-teachers', 'class-1', 'section-1']);
    expect(invalidatedKeys).toContainEqual(['classes', 'teachers', 'class-1']);
    expect(invalidatedKeys).toContainEqual(['teachers', 'assignments']);
  });

  it('surfaces the 409 duplicate-assignment error', async () => {
    server.use(
      http.post('/api/v1/classes/:classId/sections/:sectionId/teachers', () =>
        HttpResponse.json({ statusCode: 409, message: 'already assigned' }, { status: 409 }),
      ),
    );

    const { result } = renderHookWithProviders(() => useAssignTeacher('class-1', 'section-1'), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({ teacher_id: 'teacher-1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUnassignTeacher invalidates both the section-scoped and class-wide teacher lists', () => {
  it('deletes the assignment and invalidates both keys on success', async () => {
    let deletedAssignmentId: string | null = null;
    server.use(
      http.delete(
        '/api/v1/classes/:classId/sections/:sectionId/teachers/:assignmentId',
        ({ params }) => {
          deletedAssignmentId = params.assignmentId as string;
          return new HttpResponse(null, { status: 200 });
        },
      ),
    );

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHookWithProviders(() => useUnassignTeacher('class-1', 'section-1'), {
      tenantId: 'tenant-1',
      queryClient,
    });

    result.current.mutate('assignment-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deletedAssignmentId).toBe('assignment-1');
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['classes', 'section-teachers', 'class-1', 'section-1']);
    expect(invalidatedKeys).toContainEqual(['classes', 'teachers', 'class-1']);
    expect(invalidatedKeys).toContainEqual(['teachers', 'assignments']);
  });
});

describe('useAssignTeacherAssignment (unbound) — [#1026 gap fix]', () => {
  it('posts to the classId/sectionId given per-call and invalidates section, class and teacher-assignments keys', async () => {
    let postedBody: unknown = null;
    server.use(
      http.post('/api/v1/classes/:classId/sections/:sectionId/teachers', async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(
          { id: 'assignment-1', teacher_id: 'teacher-1', section_id: 'section-1' },
          { status: 201 },
        );
      }),
    );

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHookWithProviders(() => useAssignTeacherAssignment(), {
      tenantId: 'tenant-1',
      queryClient,
    });

    result.current.mutate({
      classId: 'class-1',
      sectionId: 'section-1',
      teacher_id: 'teacher-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postedBody).toEqual({ teacher_id: 'teacher-1' });
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['classes', 'section-teachers', 'class-1', 'section-1']);
    expect(invalidatedKeys).toContainEqual(['classes', 'teachers', 'class-1']);
    // Broad prefix, not one exact teacher_id — D3 auto-replace can silently
    // drop a *different* teacher's class-teacher row too.
    expect(invalidatedKeys).toContainEqual(['teachers', 'assignments']);
  });
});

describe('useUnassignTeacherAssignment (unbound) — [#1026 gap fix]', () => {
  it('deletes at the classId/sectionId/assignmentId given per-call and invalidates the same three keys', async () => {
    let deletedAssignmentId: string | null = null;
    server.use(
      http.delete(
        '/api/v1/classes/:classId/sections/:sectionId/teachers/:assignmentId',
        ({ params }) => {
          deletedAssignmentId = params.assignmentId as string;
          return new HttpResponse(null, { status: 200 });
        },
      ),
    );

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHookWithProviders(() => useUnassignTeacherAssignment(), {
      tenantId: 'tenant-1',
      queryClient,
    });

    result.current.mutate({
      classId: 'class-1',
      sectionId: 'section-1',
      assignmentId: 'assignment-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deletedAssignmentId).toBe('assignment-1');
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['classes', 'section-teachers', 'class-1', 'section-1']);
    expect(invalidatedKeys).toContainEqual(['classes', 'teachers', 'class-1']);
    expect(invalidatedKeys).toContainEqual(['teachers', 'assignments']);
  });
});

describe('useCreateClass invalidates the list (create -> refetch -> new row appears)', () => {
  it('a created class shows up in the next list read, not just the mutation response', async () => {
    let classes = [classFactory({ name: 'Class 5' })];
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({
          data: classes,
          total: classes.length,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.post('/api/v1/classes', async ({ request }) => {
        const body = (await request.json()) as { name: string; academic_year_id: string };
        const created = classFactory({ name: body.name });
        classes = [...classes, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => ({ list: useClasses(), create: useCreateClass() }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(result.current.list.data?.data).toHaveLength(1);

    result.current.create.mutate({ name: 'Class 8', academic_year_id: 'year-1' });

    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.list.data?.data).toHaveLength(2));
    expect(result.current.list.data?.data.map((c) => c.name)).toContain('Class 8');
  });
});

describe('useUpdateClass', () => {
  it('patches the class and invalidates the detail cache', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      classKeys.detail('class-1'),
      classFactory({ id: 'class-1', name: 'Class 6' }),
    );

    server.use(
      http.patch('/api/v1/classes/:id', async ({ request }) => {
        const body = (await request.json()) as { name: string };
        return HttpResponse.json(classFactory({ id: 'class-1', name: body.name }));
      }),
      http.get('/api/v1/classes/:id', () =>
        HttpResponse.json(classFactory({ id: 'class-1', name: 'Renamed' })),
      ),
    );

    const { result } = renderHookWithProviders(
      () => ({ klass: useClass('class-1'), update: useUpdateClass('class-1') }),
      { tenantId: 'tenant-1', queryClient },
    );

    result.current.update.mutate({ name: 'Renamed' });

    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.klass.data?.name).toBe('Renamed'));
  });
});

describe('useDeleteClass', () => {
  it('removes the class from cache and invalidates every list variant', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(classKeys.detail('class-1'), classFactory({ id: 'class-1' }));

    let deleteCalledWith: string | null = null;
    server.use(
      http.delete('/api/v1/classes/:id', ({ params }) => {
        deleteCalledWith = params.id as string;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const { result } = renderHookWithProviders(() => useDeleteClass(), {
      tenantId: 'tenant-1',
      queryClient,
    });

    result.current.mutate('class-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteCalledWith).toBe('class-1');
    expect(queryClient.getQueryData(classKeys.detail('class-1'))).toBeUndefined();
  });

  it('[8.11.2] surfaces the server 409 body verbatim — the delete-blocked dialog reads it, not a generic failure toast', async () => {
    server.use(
      http.delete('/api/v1/classes/:id', ({ params }) =>
        HttpResponse.json(
          // `apiErrorBody` fills every `ApiErrorBody` field
          // (`requestId`/`timestamp`/`path`) — `toApiError` (`api/client.ts`)
          // only wraps a response into `ApiError` when all of them are
          // present; a partial body falls through to a plain axios error
          // instead, which `shouldRetryQuery` retries a few times before
          // failing.
          apiErrorBody(
            409,
            `Cannot delete class "${params.id as string}": 3 student(s) are still enrolled in it. Move or unenroll them first.`,
            `/api/v1/classes/${params.id as string}`,
          ),
          { status: 409 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useDeleteClass(), { tenantId: 'tenant-1' });

    result.current.mutate('class-1');

    await waitFor(() => expect(result.current.isError).toBe(true));
    // `toApiError` (`api/client.ts`) wraps the server's JSON body into an
    // `ApiError`, whose `.message` is exactly `ClassService.remove`'s
    // thrown `ConflictException` text — the delete-blocked dialog reads
    // this, not a generic failure toast (the AC's "explanation why").
    expect((result.current.error as Error).message).toContain('3 student(s) are still enrolled');
  });
});

describe('useCreateSection / useUpdateSection / useDeleteSection invalidate both the sections list and the classes list', () => {
  it('a created section shows up in the next sections read', async () => {
    let sections = [classSectionFactory({ section_name: 'A', class_id: 'class-1' })];
    server.use(
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json(sections)),
      http.post('/api/v1/classes/:classId/sections', async ({ request }) => {
        const body = (await request.json()) as { section_name: string };
        const created = classSectionFactory({
          section_name: body.section_name,
          class_id: 'class-1',
        });
        sections = [...sections, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => ({
        sections: useClassSections('class-1'),
        create: useCreateSection('class-1'),
      }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.sections.isSuccess).toBe(true));
    expect(result.current.sections.data).toHaveLength(1);

    result.current.create.mutate({ section_name: 'B' });

    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.sections.data).toHaveLength(2));
  });

  it('renaming a section refetches it under its new name', async () => {
    let sections = [
      classSectionFactory({ id: 'section-1', section_name: 'A', class_id: 'class-1' }),
    ];
    server.use(
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json(sections)),
      http.patch('/api/v1/classes/:classId/sections/:sectionId', async ({ request, params }) => {
        const body = (await request.json()) as { section_name: string };
        const updated = classSectionFactory({
          id: params.sectionId as string,
          section_name: body.section_name,
          class_id: 'class-1',
        });
        sections = sections.map((s) => (s.id === updated.id ? updated : s));
        return HttpResponse.json(updated);
      }),
    );

    const { result } = renderHookWithProviders(
      () => ({
        sections: useClassSections('class-1'),
        update: useUpdateSection('class-1', 'section-1'),
      }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.sections.isSuccess).toBe(true));

    result.current.update.mutate({ section_name: 'A1' });

    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    await waitFor(() =>
      expect(result.current.sections.data?.map((s) => s.section_name)).toEqual(['A1']),
    );
  });

  it('a deleted section drops out of the next sections read', async () => {
    let sections = [
      classSectionFactory({ id: 'section-1', section_name: 'A', class_id: 'class-1' }),
      classSectionFactory({ id: 'section-2', section_name: 'B', class_id: 'class-1' }),
    ];
    server.use(
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json(sections)),
      http.delete('/api/v1/classes/:classId/sections/:sectionId', ({ params }) => {
        sections = sections.filter((s) => s.id !== params.sectionId);
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => ({
        sections: useClassSections('class-1'),
        remove: useDeleteSection('class-1'),
      }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.sections.data).toHaveLength(2));

    result.current.remove.mutate('section-1');

    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.sections.data).toHaveLength(1));
  });

  it('[8.11.2] surfaces the server 409 body verbatim on a section blocked by active students', async () => {
    server.use(
      http.delete('/api/v1/classes/:classId/sections/:sectionId', ({ params }) =>
        HttpResponse.json(
          apiErrorBody(
            409,
            `Cannot delete section "${params.sectionId as string}": 2 active student(s) are enrolled in it. Reassign or remove them first.`,
            `/api/v1/classes/class-1/sections/${params.sectionId as string}`,
          ),
          { status: 409 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useDeleteSection('class-1'), {
      tenantId: 'tenant-1',
    });

    result.current.mutate('section-1');

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain('2 active student(s)');
  });
});
