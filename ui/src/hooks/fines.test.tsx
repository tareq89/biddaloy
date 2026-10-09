/**
 * [38.3.1] `fines.ts` — cloned from `fee-generation.test.tsx`'s shape:
 * list/totals, invalidation on write, the approval step-up retry
 * (`promotions.test.tsx`'s pattern, `useCheckout`/`useReversePayment`'s
 * `ApprovalScope`), and the preview/generate round-trip.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { feeDuesKeys } from './fee-dues';
import {
  finesKeys,
  useFines,
  useGenerateFines,
  useLogFine,
  usePreviewFineGeneration,
  useWaiveFine,
} from './fines';

afterEach(async () => {
  await cleanupTestState();
});

describe('useFines', () => {
  it('returns items and the totals footer', async () => {
    server.use(
      http.get('/api/v1/fees/fines', () =>
        HttpResponse.json({
          items: [{ id: 'fine-1' }],
          total: 1,
          totals: { charged: 500, collected: 200, waived: 0, outstanding: 300 },
        }),
      ),
    );

    const { result } = renderHookWithProviders(() => useFines({ month: 3 }), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(1);
    expect(result.current.data?.totals).toEqual({
      charged: 500,
      collected: 200,
      waived: 0,
      outstanding: 300,
    });
  });
});

describe('useLogFine', () => {
  it('invalidates the fines, fee-dues and student-fees query keys', async () => {
    server.use(
      http.post('/api/v1/fees/fines', () =>
        HttpResponse.json({ bill_ids: ['bill-1'] }, { status: 201 }),
      ),
    );

    function Harness() {
      const logFine = useLogFine();
      return (
        <div>
          <button
            onClick={() =>
              logFine.mutate({
                student_ids: ['student-1'],
                fee_structure_id: 'fee-1',
                note: 'Late arrival',
                incident_date: '2026-03-01',
                notify_families: true,
              })
            }
          >
            log
          </button>
          {logFine.isSuccess && <span data-testid="done" />}
        </div>
      );
    }

    const { queryClient } = renderWithProviders(<Harness />, {
      tenantId: 'tenant-1',
      locale: 'en',
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'log' }));

    await screen.findByTestId('done');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: finesKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: feeDuesKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['student-fees'] });
  });
});

describe('useWaiveFine', () => {
  function Harness() {
    const waive = useWaiveFine();
    return (
      <div>
        <button onClick={() => waive.mutate({ id: 'fine-1', reason: 'Already paid in cash' })}>
          waive
        </button>
        {waive.isSuccess && <span data-testid="result">{waive.data?.status}</span>}
      </div>
    );
  }

  it('retries with an approval token after a 403 APPROVAL_REQUIRED', async () => {
    let attempt = 0;
    server.use(
      http.post('/api/v1/fees/fines/fine-1/waive', ({ request }) => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            {
              statusCode: 403,
              message: 'Approval required',
              timestamp: new Date().toISOString(),
              path: '/fees/fines/fine-1/waive',
              requestId: 'req-1',
              details: { code: 'APPROVAL_REQUIRED' },
            },
            { status: 403 },
          );
        }
        expect(request.headers.get('X-Approval-Token')).toBe('tok-123');
        return HttpResponse.json({ id: 'fine-1', amount: 100, status: 'WAIVED' }, { status: 201 });
      }),
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json(
          { approval_token: 'tok-123', approver: { id: 'u1', name: 'Admin' } },
          { status: 201 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<Harness />, { locale: 'en', tenantId: 'tenant-1' });

    await user.click(screen.getByRole('button', { name: 'waive' }));
    await screen.findByRole('dialog');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await screen.findByText('WAIVED', { selector: '[data-testid="result"]' });
    expect(attempt).toBe(2);
  });
});

describe('fine generation preview/generate', () => {
  it('previews then generates a fine sweep', async () => {
    server.use(
      http.post('/api/v1/fees/fines/generate/preview', () =>
        HttpResponse.json(
          { students: [], total_amount: 500, would_create: 3, duplicates: [] },
          { status: 201 },
        ),
      ),
      http.post('/api/v1/fees/fines/generate', () =>
        HttpResponse.json(
          { fee_generation_ids: ['gen-1'], generated_count: 3, skipped_count: 0 },
          { status: 201 },
        ),
      ),
    );

    const { result: preview } = renderHookWithProviders(() => usePreviewFineGeneration(), {
      tenantId: 'tenant-1',
    });
    preview.current.mutate({ month: '2026-03' });
    await waitFor(() => expect(preview.current.isSuccess).toBe(true));
    expect(preview.current.data?.would_create).toBe(3);

    function Harness() {
      const generate = useGenerateFines();
      return (
        <div>
          <button onClick={() => generate.mutate({ month: '2026-03', duplicate_strategy: 'SKIP' })}>
            generate
          </button>
          {generate.isSuccess && (
            <span data-testid="generated">{generate.data.generated_count}</span>
          )}
        </div>
      );
    }

    const user = userEvent.setup();
    renderWithProviders(<Harness />, { tenantId: 'tenant-1', locale: 'en' });
    await user.click(screen.getByRole('button', { name: 'generate' }));
    await screen.findByText('3', { selector: '[data-testid="generated"]' });
  });
});
