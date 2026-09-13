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
    month: 3,
    year: 2026,
    due_date: '2026-03-10',
    student_ids: ['student-1'],
    fee_structure_ids: ['fee-1'],
  };
}

describe('useGenerateFeesPreview', () => {
  it('posts the scope to /fees/generate/preview and resolves the duplicate report', async () => {
    server.use(
      http.post('/api/v1/fees/generate/preview', () =>
        HttpResponse.json({
          students_evaluated: 1,
          will_generate: 0,
          duplicates: [
            {
              student_id: 'student-1',
              student_name: 'Rahim Uddin',
              fee_structure_id: 'fee-1',
              fee_structure_name: 'Tuition',
              existing_fee_id: 'existing-1',
              existing_created_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          inactive_students: [],
        }),
      ),
    );

    const { result } = renderHookWithProviders(() => useGenerateFeesPreview(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate(baseScope());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.duplicates).toHaveLength(1);
  });
});

describe('useGenerateFees', () => {
  it('posts the scope + notify flag to /fees/generate and resolves the three counts', async () => {
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

    function Harness() {
      const generate = useGenerateFees();
      return (
        <div>
          <button onClick={() => generate.mutate({ ...baseScope(), notify_families: true })}>
            run
          </button>
          {generate.isSuccess && <span data-testid="result">{generate.data.generated}</span>}
          {generate.modal}
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
        HttpResponse.json({ generated: 1, skipped: 0, students_evaluated: 1 }, { status: 201 }),
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
          {generate.modal}
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
          {generate.modal}
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
