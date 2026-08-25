import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { feeDuesKeys } from './fee-dues';
import { useGenerateFees } from './fee-generation';
import { paymentKeys } from './payments';

describe('useGenerateFees', () => {
  it('posts the scope to /fees/generate and resolves the three counts', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/fees/generate', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { generated: 12, skipped: 3, students_evaluated: 15 },
          { status: 201 },
        );
      }),
    );

    const { result } = renderHookWithProviders(() => useGenerateFees(), { tenantId: 'tenant-1' });

    result.current.mutate({
      academic_year_id: 'year-1',
      month: 3,
      year: 2026,
      class_id: 'class-9',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({
      academic_year_id: 'year-1',
      month: 3,
      year: 2026,
      class_id: 'class-9',
    });
    expect(result.current.data).toEqual({ generated: 12, skipped: 3, students_evaluated: 15 });
  });

  // Business-critical: the generated fees change what's outstanding, so
  // the dues queue and every payment-scoped query (including the record-
  // payment wizard's fee summary, which lives outside `paymentKeys.lists()`)
  // must be marked stale or a collector keeps working from pre-batch data.
  it('invalidates the fee-dues lists and every payment query on success', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHookWithProviders(() => useGenerateFees(), {
      tenantId: 'tenant-1',
      queryClient,
    });

    result.current.mutate({ academic_year_id: 'year-1', month: 3, year: 2026 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: feeDuesKeys.lists() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: paymentKeys.all });
  });

  // The endpoint is rate-limited to 5 runs a minute, so a client-side
  // retry would spend the accountant's remaining runs re-asking a
  // question the server already answered. One request, one failure.
  it('does not retry a rejected batch', async () => {
    let calls = 0;
    server.use(
      http.post('/api/v1/fees/generate', () => {
        calls += 1;
        return new HttpResponse(null, { status: 429, headers: { 'Retry-After': '30' } });
      }),
    );

    const { result } = renderHookWithProviders(() => useGenerateFees(), { tenantId: 'tenant-1' });

    result.current.mutate({ academic_year_id: 'year-1', month: 3, year: 2026 });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });
});
