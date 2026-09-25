/**
 * [26.4.2] `useCommitPromotionRun` — the server only demands a step-up
 * approval when the run has overrides; this pins both branches. Cloned
 * from `grading.test.tsx`'s `useConfirmBands` case (no-approval path) and
 * `approval.test.tsx`'s step-up flow (with-approval path).
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { useCommitPromotionRun, type PromotionRunDetail } from './promotions';

afterEach(async () => {
  await cleanupTestState();
});

function runFactory(overrides: Partial<PromotionRunDetail> = {}): PromotionRunDetail {
  return {
    id: 'run-1',
    tenant_id: 'tenant-1',
    source_class_id: 'class-1',
    source_academic_year_id: 'year-1',
    target_academic_year_id: 'year-2',
    target_class_id: 'class-2',
    exam_ids: ['exam-1'],
    algorithm: 'BLOCK',
    status: 'COMMITTED',
    refreshed_at: '2026-01-01T00:00:00.000Z',
    committed_at: '2026-01-02T00:00:00.000Z',
    committed_by_user_id: 'user-1',
    approved_by_user_id: null,
    override_count: 0,
    created_by_user_id: 'user-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    entries: [],
    ...overrides,
  };
}

describe('useCommitPromotionRun — no overrides', () => {
  it('commits on the first request, no approval token sent', async () => {
    let sawApprovalHeader = false;
    server.use(
      http.post('/api/v1/promotions/run-1/commit', ({ request }) => {
        if (request.headers.get('X-Approval-Token')) sawApprovalHeader = true;
        return HttpResponse.json(runFactory({ override_count: 0 }));
      }),
    );

    const { result } = renderHookWithProviders(() => useCommitPromotionRun('run-1'), {
      tenantId: 'tenant-1',
    });

    result.current.mutate(undefined);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.override_count).toBe(0);
    expect(sawApprovalHeader).toBe(false);
  });
});

describe('useCommitPromotionRun — with overrides', () => {
  function Harness() {
    const commit = useCommitPromotionRun('run-1');
    return (
      <div>
        <button onClick={() => commit.mutate(undefined)}>commit</button>
        {commit.isSuccess && <span data-testid="result">{commit.data?.override_count}</span>}
      </div>
    );
  }

  it('retries with an approval token once the server demands one', async () => {
    let attempt = 0;
    server.use(
      http.post('/api/v1/promotions/run-1/commit', ({ request }) => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            {
              statusCode: 403,
              message: 'Approval required',
              timestamp: new Date().toISOString(),
              path: '/promotions/run-1/commit',
              requestId: 'req-1',
              details: { code: 'APPROVAL_REQUIRED' },
            },
            { status: 403 },
          );
        }
        expect(request.headers.get('X-Approval-Token')).toBe('tok-123');
        return HttpResponse.json(runFactory({ override_count: 2 }));
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

    await user.click(screen.getByRole('button', { name: 'commit' }));
    await screen.findByRole('dialog');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await screen.findByText('2', { selector: '[data-testid="result"]' });
    expect(attempt).toBe(2);
  });
});
