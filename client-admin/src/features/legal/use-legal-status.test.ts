import { cleanupTestState, renderHookWithProviders, server } from '@biddaloy/ui/test';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { legalStatusKey, legalStatusQuery, useAcceptLegal } from './use-legal-status';

afterEach(async () => {
  await cleanupTestState();
});

describe('legal status hooks', () => {
  it('status query is cached 5 minutes and does not retry', () => {
    expect(legalStatusQuery.staleTime).toBe(5 * 60_000);
    expect(legalStatusQuery.retry).toBe(false);
  });

  it('accept posts once and invalidates the status', async () => {
    let posts = 0;
    server.use(
      http.post('/api/v1/legal/accept', () => {
        posts += 1;
        return HttpResponse.json({ pending: [] });
      }),
    );
    const { result, queryClient } = renderHookWithProviders(() => useAcceptLegal(), {
      tenantId: 'tenant-1',
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    result.current.mutate(['terms']);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(posts).toBe(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: legalStatusKey });
  });

  it('a failed accept is not retried', async () => {
    let posts = 0;
    server.use(
      http.post('/api/v1/legal/accept', () => {
        posts += 1;
        return HttpResponse.json({ message: 'x' }, { status: 500 });
      }),
    );
    const { result } = renderHookWithProviders(() => useAcceptLegal(), { tenantId: 'tenant-1' });
    result.current.mutate(['terms']);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(posts).toBe(1);
  });
});
