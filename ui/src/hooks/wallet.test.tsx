import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { useWalletPayout } from './wallet';

afterEach(async () => {
  await cleanupTestState();
});

describe('useWalletPayout', () => {
  function Harness() {
    const payout = useWalletPayout();
    return (
      <div>
        <button
          onClick={() =>
            payout.mutate({ studentId: 'student-1', amount: 40, reason: 'Left school' })
          }
        >
          pay
        </button>
        {payout.isSuccess && <span data-testid="result">{String(payout.data?.balance)}</span>}
      </div>
    );
  }

  it('posts to /students/:id/wallet/payout and retries once with the approval token', async () => {
    let attempt = 0;
    server.use(
      http.post('/api/v1/students/student-1/wallet/payout', async ({ request }) => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            {
              statusCode: 403,
              message: 'Approval required',
              timestamp: new Date().toISOString(),
              path: '/students/student-1/wallet/payout',
              requestId: 'req-1',
              details: { code: 'APPROVAL_REQUIRED' },
            },
            { status: 403 },
          );
        }
        expect(request.headers.get('X-Approval-Token')).toBe('tok-123');
        expect(await request.json()).toEqual({ amount: 40, reason: 'Left school' });
        return HttpResponse.json({ balance: 10, transactions: [] });
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

    await user.click(screen.getByRole('button', { name: 'pay' }));
    await screen.findByRole('dialog');
    await user.type(screen.getByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await screen.findByText('10', { selector: '[data-testid="result"]' });
    expect(attempt).toBe(2);
  });
});
