/**
 * [28.3.1] `acr.ts` — autosave debounces edits into one PATCH and surfaces a
 * failure; completing invalidates the register.
 */
import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { acrAssessmentFactory } from '../test/factories/acr';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import { acrKeys, useAcrAutosave, useCompleteAcr } from './acr';

afterEach(async () => {
  await cleanupTestState();
});

describe('useAcrAutosave', () => {
  it('debounces a burst of edits into one PATCH with merged scores', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch('/api/v1/acr/assessments/:id', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(acrAssessmentFactory({ id: 'acr-1' }));
      }),
    );

    const { result } = renderHookWithProviders(() => useAcrAutosave('acr-1', { debounceMs: 20 }), {
      tenantId: 'tenant-1',
    });

    act(() => {
      result.current.stageScore('c1', 4);
      result.current.stageScore('c1', 3);
      result.current.stageScore('c2', 2);
      result.current.stageStep1({ description: 'Teaches maths' });
    });

    await waitFor(() => expect(result.current.state).toBe('saved'));
    expect(bodies).toEqual([
      {
        step1_data: { description: 'Teaches maths' },
        scores: [
          { criterion_id: 'c1', score: 3 },
          { criterion_id: 'c2', score: 2 },
        ],
      },
    ]);
  });

  it('surfaces a failed save and keeps the value staged', async () => {
    server.use(
      http.patch('/api/v1/acr/assessments/:id', () =>
        HttpResponse.json({ message: 'nope' }, { status: 500 }),
      ),
    );

    const { result } = renderHookWithProviders(
      () => useAcrAutosave('acr-1', { debounceMs: 10, retryBaseMs: 60_000 }),
      { tenantId: 'tenant-1' },
    );

    act(() => result.current.stageScore('c1', 4));

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect([...result.current.failedKeys]).toEqual(['score:c1']);
    expect(result.current.pendingCount).toBe(1);
  });
});

describe('useCompleteAcr', () => {
  it('invalidates the register and the staff history', async () => {
    server.use(
      http.post('/api/v1/acr/assessments/:id/complete', () =>
        HttpResponse.json(
          acrAssessmentFactory({ id: 'acr-1', user_id: 'u-1', status: 'COMPLETED', total: 9 }),
        ),
      ),
    );

    const { result, queryClient } = renderHookWithProviders(() => useCompleteAcr(), {
      tenantId: 'tenant-1',
      seedQueries: [
        { queryKey: acrKeys.list({}), data: [] },
        { queryKey: ['acr-staff', 'detail', 'u-1'], data: [] },
      ],
    });

    await act(() => result.current.mutateAsync('acr-1'));

    expect(queryClient.getQueryState(acrKeys.list({}))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['acr-staff', 'detail', 'u-1'])?.isInvalidated).toBe(true);
  });
});
