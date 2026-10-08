import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setActiveTenant } from '../api/auth-state';
import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  downloadStudyPlanLessonsCsv,
  lessonDeliveryKeys,
  studyPlanKeys,
  studyPlanTemplateKeys,
  useCopyStudyPlanTemplate,
  useMyLessonDeliveries,
  useStudentStudyPlans,
  useStudyPlan,
  useStudyPlans,
  useUpsertLessonDelivery,
} from './study-plans';

const opts = { tenantId: 'tenant-1' };

afterEach(() => vi.restoreAllMocks());

describe('study plan queries', () => {
  it('sends only the defined list filters', async () => {
    let url: URL | undefined;
    server.use(
      http.get('/api/v1/study-plans', ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );
    const { result } = renderHookWithProviders(
      () => useStudyPlans({ class_id: 'c1', behind: true }),
      opts,
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(url?.searchParams.get('class_id')).toBe('c1');
    expect(url?.searchParams.get('behind')).toBe('true');
    expect(url?.searchParams.has('q')).toBe(false);
    expect(url?.searchParams.has('section_id')).toBe(false);
  });

  it('asks for teacher=me and the date', async () => {
    let url: URL | undefined;
    server.use(
      http.get('/api/v1/lesson-deliveries', ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ date: '2026-10-09', periods: [] });
      }),
    );
    const { result } = renderHookWithProviders(() => useMyLessonDeliveries('2026-10-09'), opts);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(url?.searchParams.get('teacher')).toBe('me');
    expect(url?.searchParams.get('date')).toBe('2026-10-09');
  });

  it('sends no request for an undefined student id', async () => {
    let hits = 0;
    server.use(
      http.get('/api/v1/students/:id/study-plans', () => {
        hits += 1;
        return HttpResponse.json({});
      }),
    );
    const { result } = renderHookWithProviders(() => useStudentStudyPlans(undefined), opts);
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.fetchStatus).toBe('idle');
    expect(hits).toBe(0);
  });

  it('does not retry a 4xx', async () => {
    let hits = 0;
    server.use(
      http.get('/api/v1/study-plans/:id', () => {
        hits += 1;
        return HttpResponse.json(apiErrorBody(404, 'Not found', '/study-plans/p1'), {
          status: 404,
        });
      }),
    );
    const { result } = renderHookWithProviders(() => useStudyPlan('p1'), opts);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(hits).toBe(1);
  });
});

describe('invalidation', () => {
  it('a delivery change invalidates lesson-deliveries and study-plans', async () => {
    server.use(http.put('/api/v1/lesson-deliveries', () => HttpResponse.json({ id: 'd1' })));
    const { result, queryClient } = renderHookWithProviders(() => useUpsertLessonDelivery(), opts);
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await act(async () => {
      await result.current.mutateAsync({} as never);
    });
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(lessonDeliveryKeys.all);
    expect(keys).toContainEqual(studyPlanKeys.all);
  });

  it('a template copy invalidates study-plans (and templates)', async () => {
    server.use(
      http.post('/api/v1/study-plan-templates/t1/copy', () => HttpResponse.json({ id: 'p1' })),
    );
    const { result, queryClient } = renderHookWithProviders(
      () => useCopyStudyPlanTemplate('t1'),
      opts,
    );
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await act(async () => {
      await result.current.mutateAsync({} as never);
    });
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(studyPlanKeys.all);
    expect(keys).toContainEqual(studyPlanTemplateKeys.all);
  });
});

describe('downloadStudyPlanLessonsCsv', () => {
  it('requests a blob and names the file from Content-Disposition', async () => {
    server.use(
      http.get(
        '/api/v1/study-plans/p1/lessons.csv',
        () =>
          new HttpResponse('title,periods\n', {
            headers: {
              'content-type': 'text/csv',
              'content-disposition': 'attachment; filename="plan-5-math.csv"',
            },
          }),
      ),
    );
    setActiveTenant('tenant-1');
    const createObjectURL = vi.fn(() => 'blob:x');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    await downloadStudyPlanLessonsCsv('p1');
    expect(names).toEqual(['plan-5-math.csv']);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });
});
