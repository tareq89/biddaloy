/**
 * [39.3.1] `student-lifecycle.ts` — each hook hits the right route and each
 * mutation invalidates the right query keys (msw + a spy on the client).
 */
import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import { enrollmentKeys } from './enrollments';
import {
  lifecycleEventKeys,
  studentNoteKeys,
  studentPublicExamKeys,
  useAddStudentNote,
  useDeletePublicExam,
  useDeleteStudentNote,
  useLeaveStudent,
  useLifecycleEvents,
  usePublicExams,
  useReadmitStudent,
  useSavePublicExam,
  useStudentNotes,
  useUpdateStudentRecords,
} from './student-lifecycle';
import { studentKeys } from './students';

afterEach(async () => {
  await cleanupTestState();
});

const opts = { tenantId: 'tenant-1' };
const S = 'student-1';

function invalidatedKeys(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map(([f]) => (f as { queryKey: unknown }).queryKey);
}

describe('queries', () => {
  async function expectGet(path: string, hook: () => { isSuccess: boolean; data?: unknown }) {
    server.use(http.get(path, () => HttpResponse.json([{ id: 'x' }])));
    const { result } = renderHookWithProviders(hook, opts);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'x' }]);
  }

  it('useLifecycleEvents GETs its route', () =>
    expectGet(`/api/v1/students/${S}/lifecycle-events`, () => useLifecycleEvents(S)));
  it('useStudentNotes GETs its route', () =>
    expectGet(`/api/v1/students/${S}/notes`, () => useStudentNotes(S)));
  it('usePublicExams GETs its route', () =>
    expectGet(`/api/v1/students/${S}/public-exams`, () => usePublicExams(S)));

  it('does not fetch without a student id', () => {
    const { result } = renderHookWithProviders(() => useStudentNotes(''), opts);
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useUpdateStudentRecords', () => {
  it('[39.2.4] PATCHes /students/:id/records (not /students/:id) and invalidates detail + lists', async () => {
    // An EXECUTIVE can only call the /records route; the general PATCH would 401 for them.
    const seen: { body?: unknown; generalPatchCalled: boolean } = { generalPatchCalled: false };
    server.use(
      http.patch(`/api/v1/students/${S}/records`, async ({ request }) => {
        seen.body = await request.json();
        return HttpResponse.json({ id: S, religion: 'Islam' });
      }),
      http.patch(`/api/v1/students/${S}`, () => {
        seen.generalPatchCalled = true;
        return HttpResponse.json({}, { status: 401 });
      }),
    );
    const { result, queryClient } = renderHookWithProviders(() => useUpdateStudentRecords(S), opts);
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await act(async () => {
      await result.current.mutateAsync({ religion: 'Islam', health_notes: null });
    });
    expect(seen.body).toEqual({ religion: 'Islam', health_notes: null });
    expect(seen.generalPatchCalled).toBe(false);
    expect(invalidatedKeys(spy)).toContainEqual(studentKeys.detail(S));
    expect(invalidatedKeys(spy)).toContainEqual(studentKeys.lists());
  });
});

describe('lifecycle mutations', () => {
  const leaveBody = { type: 'WITHDRAWN', occurred_on: '2026-09-30', reason: 'r' } as const;
  const readmitBody = { occurred_on: '2026-09-30', class_section_id: 'cs-1' };

  function mockPost(route: 'leave' | 'readmit') {
    const seen: { body?: unknown } = {};
    server.use(
      http.post(`/api/v1/students/${S}/${route}`, async ({ request }) => {
        seen.body = await request.json();
        return HttpResponse.json({ id: 'evt-1' }, { status: 201 });
      }),
    );
    return seen;
  }

  function expectLifecycleKeys(spy: { mock: { calls: unknown[][] } }) {
    const keys = invalidatedKeys(spy);
    expect(keys).toContainEqual(studentKeys.detail(S));
    expect(keys).toContainEqual(studentKeys.lists());
    expect(keys).toContainEqual(enrollmentKeys.all);
    expect(keys).toContainEqual(lifecycleEventKeys.list({ studentId: S }));
  }

  it('leave posts and invalidates detail, lists, enrollments and events', async () => {
    const seen = mockPost('leave');
    const { result, queryClient } = renderHookWithProviders(() => useLeaveStudent(S), opts);
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await act(async () => {
      await result.current.mutateAsync(leaveBody);
    });
    expect(seen.body).toEqual(leaveBody);
    expectLifecycleKeys(spy);
  });

  it('readmit posts and invalidates detail, lists, enrollments and events', async () => {
    const seen = mockPost('readmit');
    const { result, queryClient } = renderHookWithProviders(() => useReadmitStudent(S), opts);
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await act(async () => {
      await result.current.mutateAsync(readmitBody);
    });
    expect(seen.body).toEqual(readmitBody);
    expectLifecycleKeys(spy);
  });

  it('surfaces a server 409 as a rejected mutation', async () => {
    server.use(
      http.post(`/api/v1/students/${S}/leave`, () =>
        HttpResponse.json({ message: 'already left' }, { status: 409 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useLeaveStudent(S), opts);
    await act(async () => {
      await expect(
        result.current.mutateAsync({ type: 'WITHDRAWN', occurred_on: '2026-09-30', reason: 'r' }),
      ).rejects.toBeDefined();
    });
  });
});

describe('note mutations', () => {
  it('add posts the body and invalidates the notes list', async () => {
    server.use(
      http.post(`/api/v1/students/${S}/notes`, () =>
        HttpResponse.json({ id: 'n-1' }, { status: 201 }),
      ),
    );
    const { result, queryClient } = renderHookWithProviders(() => useAddStudentNote(S), opts);
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await act(async () => {
      await result.current.mutateAsync({ body: 'hello' });
    });
    expect(invalidatedKeys(spy)).toContainEqual(studentNoteKeys.list({ studentId: S }));
  });

  it('delete hits the note route and invalidates the notes list', async () => {
    server.use(
      http.delete(`/api/v1/students/${S}/notes/n-1`, () => new HttpResponse(null, { status: 204 })),
    );
    const { result, queryClient } = renderHookWithProviders(() => useDeleteStudentNote(S), opts);
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await act(async () => {
      await result.current.mutateAsync('n-1');
    });
    expect(invalidatedKeys(spy)).toContainEqual(studentNoteKeys.list({ studentId: S }));
  });
});

describe('public exam mutations', () => {
  const exam = {
    exam_type: 'SSC',
    passing_year: 2024,
    board: 'Dhaka',
    roll_no: '1',
    registration_no: '2',
  } as const;

  it('save without examId POSTs; with examId PATCHes (id not in body)', async () => {
    let created: unknown;
    let patched: unknown;
    server.use(
      http.post(`/api/v1/students/${S}/public-exams`, async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({ id: 'e-1' }, { status: 201 });
      }),
      http.patch(`/api/v1/students/${S}/public-exams/e-1`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ id: 'e-1' });
      }),
    );
    const { result, queryClient } = renderHookWithProviders(() => useSavePublicExam(S), opts);
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync(exam);
    });
    expect(created).toEqual(exam);

    await act(async () => {
      await result.current.mutateAsync({ examId: 'e-1', board: 'Comilla' });
    });
    expect(patched).toEqual({ board: 'Comilla' });
    expect(invalidatedKeys(spy)).toContainEqual(studentPublicExamKeys.list({ studentId: S }));
  });

  it('delete hits the exam route and invalidates the exam list', async () => {
    server.use(
      http.delete(
        `/api/v1/students/${S}/public-exams/e-1`,
        () => new HttpResponse(null, { status: 200 }),
      ),
    );
    const { result, queryClient } = renderHookWithProviders(() => useDeletePublicExam(S), opts);
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await act(async () => {
      await result.current.mutateAsync('e-1');
    });
    expect(invalidatedKeys(spy)).toContainEqual(studentPublicExamKeys.list({ studentId: S }));
  });
});
