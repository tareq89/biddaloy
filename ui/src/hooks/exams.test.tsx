import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { examKeys, studentResultCardKey, useDeleteExam, usePublishResults } from './exams';

describe('useDeleteExam', () => {
  it('DELETEs the exam by id and invalidates the exams list', async () => {
    let calledPath: string | undefined;
    server.use(
      http.delete('/api/v1/exams/:id', ({ params }) => {
        calledPath = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result, queryClient } = renderHookWithProviders(() => useDeleteExam(), {
      tenantId: 'tenant-1',
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    queryClient.setQueryData(examKeys.detail('e1'), { id: 'e1' });

    await result.current.mutateAsync('e1');

    expect(calledPath).toBe('e1');
    expect(queryClient.getQueryData(examKeys.detail('e1'))).toBeUndefined();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: examKeys.lists() }));
  });
});

describe('usePublishResults', () => {
  it('marks the staff report card stale, so it never prints old results [#2922]', async () => {
    server.use(
      http.post('/api/v1/exams/:id/results/publish', () => new HttpResponse(null, { status: 204 })),
    );
    const { result, queryClient } = renderHookWithProviders(() => usePublishResults('e1'), {
      tenantId: 'tenant-1',
    });
    queryClient.setQueryData(studentResultCardKey('s1', 'e1'), { exam_name: 'Old' });

    await result.current.mutateAsync();

    await waitFor(() =>
      expect(queryClient.getQueryState(studentResultCardKey('s1', 'e1'))?.isInvalidated).toBe(true),
    );
  });
});
