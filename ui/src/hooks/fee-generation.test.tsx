import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { renderWithProviders } from '../test/render-with-providers';

import { feeDuesKeys } from './fee-dues';
import { useGenerateFees, useGenerateFeesPreview } from './fee-generation';
import { paymentKeys } from './payments';

function baseScope() {
  return {
    academic_year_id: 'year-1',
    period_type: 'MONTH' as const,
    // `period_start`, not `month`/`year`: matches the real server DTO
    // (`GenerateFeesPreviewDto`/`GenerateFeesDto`) — see
    // `generate-fees-modal.tsx`'s own fix comment on why the client used
    // to send fields the server always rejected.
    period_start: '2026-03-01',
    due_date: '2026-03-10',
    student_ids: ['student-1'],
    fee_structure_ids: ['fee-1'],
  };
}

describe('useGenerateFeesPreview', () => {
  it('posts the scope to /fees/generate/preview and resolves the duplicate report', async () => {
    let receivedBody: unknown;
    server.use(
      http.post('/api/v1/fees/generate/preview', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          students_total: 1,
          would_generate: 0,
          duplicates: [
            {
              student_id: 'student-1',
              fee_structure_id: 'fee-1',
              existing_bill_id: 'existing-1',
              paid_amount: 500,
            },
          ],
          inactive: [],
        });
      }),
    );

    const { result } = renderHookWithProviders(() => useGenerateFeesPreview(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate(baseScope());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.duplicates).toHaveLength(1);
    // Regression: the handler used to accept any body, so it would pass
    // even if the hook sent a malformed/empty request.
    expect(receivedBody).toEqual(baseScope());
  });
});

describe('useGenerateFees', () => {
  it('posts the scope + notify flag to /fees/generate and resolves the three counts', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/fees/generate', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            fee_generation_id: 'gen-1',
            student_count: 15,
            generated_count: 12,
            skipped_count: 3,
            removed_count: 0,
            inactive_skipped: [],
          },
          { status: 201 },
        );
      }),
    );

    function Harness() {
      const generate = useGenerateFees();
      return (
        <div>
          <button onClick={() => generate.mutate({ ...baseScope(), notify_families: true })}>
            run
          </button>
          {generate.isSuccess && <span data-testid="result">{generate.data.generated_count}</span>}
        </div>
      );
    }

    const user = userEvent.setup();
    renderWithProviders(<Harness />, { tenantId: 'tenant-1', locale: 'en' });

    await user.click(screen.getByRole('button', { name: 'run' }));

    await screen.findByText('12', { selector: '[data-testid="result"]' });
    expect(body).toEqual({ ...baseScope(), notify_families: true });
  });

  it('invalidates the fee-dues lists, every payment query, and fee-generations on success', async () => {
    server.use(
      http.post('/api/v1/fees/generate', () =>
        HttpResponse.json(
          {
            fee_generation_id: 'gen-2',
            student_count: 1,
            generated_count: 1,
            skipped_count: 0,
            removed_count: 0,
            inactive_skipped: [],
          },
          { status: 201 },
        ),
      ),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    function Harness() {
      const generate = useGenerateFees();
      return (
        <div>
          <button onClick={() => generate.mutate({ ...baseScope(), notify_families: false })}>
            run
          </button>
          {generate.isSuccess && <span data-testid="done" />}
        </div>
      );
    }

    const user = userEvent.setup();
    renderWithProviders(<Harness />, { tenantId: 'tenant-1', locale: 'en', queryClient });

    await user.click(screen.getByRole('button', { name: 'run' }));

    await screen.findByTestId('done');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: feeDuesKeys.lists() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: paymentKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['fee-generations'] });
  });

  it('does not retry a rejected batch', async () => {
    let calls = 0;
    server.use(
      http.post('/api/v1/fees/generate', () => {
        calls += 1;
        return new HttpResponse(null, { status: 429, headers: { 'Retry-After': '30' } });
      }),
    );

    function Harness() {
      const generate = useGenerateFees();
      return (
        <div>
          <button onClick={() => generate.mutate({ ...baseScope(), notify_families: false })}>
            run
          </button>
          {generate.isError && <span data-testid="error" />}
        </div>
      );
    }

    const user = userEvent.setup();
    renderWithProviders(<Harness />, { tenantId: 'tenant-1', locale: 'en' });

    await user.click(screen.getByRole('button', { name: 'run' }));

    await screen.findByTestId('error');
    expect(calls).toBe(1);
  });
});
