/**
 * `/payments/online` — the "Waiting for confirmation" list ([3.4.x]) over the real route tree.
 */
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

function render() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/payments/online'],
    tenantId: 'tenant-1',
    role: 'ACCOUNTANT',
    locale: 'en',
  });
}

const item = (over: Record<string, unknown>) => ({
  id: 'p1',
  source: 'PROOF',
  status: 'PENDING',
  method: 'BKASH',
  amount: '2500.00',
  paidOn: '2026-11-13',
  reference: '8N7A6D5EFG',
  submitterName: 'Rahim Uddin Guardian',
  billCount: 2,
  createdAt: '2026-11-13T04:42:00.000Z',
  ...over,
});

describe('/payments/online', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists waiting proofs with the visible total and asks only for PENDING', async () => {
    let status: string | null = null;
    server.use(
      http.get('/api/v1/payment-submissions', ({ request }) => {
        status = new URL(request.url).searchParams.get('status');
        return HttpResponse.json({
          items: [
            item({}),
            item({ id: 'p2', submitterName: 'Karim Sheikh Guardian', reference: 'TRX2' }),
          ],
          nextCursor: null,
        });
      }),
    );
    render();

    expect(await screen.findByText('Rahim Uddin Guardian')).toBeTruthy();
    expect(screen.getByText('Karim Sheikh Guardian')).toBeTruthy();
    expect(screen.getByText('2 payment proofs waiting')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Waiting for confirmation' })).toBeTruthy();
    expect(status).toBe('PENDING');
  });

  it('shows the empty state when nothing waits', async () => {
    server.use(
      http.get('/api/v1/payment-submissions', () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    render();
    expect(await screen.findByText('Nothing is waiting for confirmation')).toBeTruthy();
  });

  it('shows an error state when the list cannot load', async () => {
    server.use(
      http.get('/api/v1/payment-submissions', () =>
        HttpResponse.json(apiErrorBody(500, 'boom', '/api/v1/payment-submissions'), {
          status: 500,
        }),
      ),
    );
    render();
    expect(await screen.findByText(/Could not load the payment proofs/)).toBeTruthy();
  });
});
