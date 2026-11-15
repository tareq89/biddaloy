/**
 * `/payments/online` — the "Waiting for confirmation" list ([3.4.x]) over the real route tree.
 */
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

function render(path = '/payments/online') {
  return renderWithRouter(routeTree, {
    initialEntries: [path],
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
  unmatched: false,
  appliedAmount: '0.00',
  walletAmount: '0.00',
  paymentId: null,
  students: [{ id: 's1', name: 'Rahim Jr' }],
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

  it('online tab lists every online payment, filters by status and asks for ONLINE', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get('/api/v1/payment-submissions', ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({
          items: [item({ source: 'ONLINE', status: 'COMPLETED', paymentId: 'pay1', method: null })],
          nextCursor: null,
        });
      }),
    );
    render('/payments/online?tab=online');
    expect(await screen.findByText('Rahim Uddin Guardian')).toBeTruthy();
    expect(screen.getByText('Rahim Jr')).toBeTruthy();
    expect(screen.getByText('1 online payment')).toBeTruthy();
    expect(seen[0]?.get('source')).toBe('ONLINE');
    expect(seen[0]?.get('status')).toBeNull();
  });

  it('online tab shows its empty state', async () => {
    server.use(
      http.get('/api/v1/payment-submissions', () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    render('/payments/online?tab=online');
    expect(await screen.findByText('No online payments yet')).toBeTruthy();
  });

  it('unmatched tab asks for unmatched=true and shows the bills / wallet split', async () => {
    let unmatched: string | null = null;
    server.use(
      http.get('/api/v1/payment-submissions', ({ request }) => {
        unmatched = new URL(request.url).searchParams.get('unmatched');
        return HttpResponse.json({
          items: [
            item({
              source: 'ONLINE',
              status: 'COMPLETED',
              unmatched: true,
              amount: '3000.00',
              appliedAmount: '2000.00',
              walletAmount: '1000.00',
              paymentId: 'pay9',
            }),
          ],
          nextCursor: null,
        });
      }),
    );
    render('/payments/online?tab=unmatched');
    expect(await screen.findByText('Rahim Uddin Guardian')).toBeTruthy();
    expect(screen.getByText('Put on bills')).toBeTruthy();
    expect(screen.getByText('Put in wallet')).toBeTruthy();
    expect(screen.getAllByText(/1,000/).length).toBeGreaterThan(0);
    expect(unmatched).toBe('true');
    // Row actions: the payment, and the student's wallet (fees tab).
    expect((await screen.findByRole('link', { name: 'Open payment' })).getAttribute('href')).toBe(
      '/payments/pay9',
    );
    expect(screen.getByRole('link', { name: 'Open wallet' }).getAttribute('href')).toBe(
      '/students/s1?tab=fees',
    );
  });

  it('unmatched tab shows its empty state', async () => {
    server.use(
      http.get('/api/v1/payment-submissions', () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    render('/payments/online?tab=unmatched');
    expect(await screen.findByText('No unmatched receipts')).toBeTruthy();
  });
});
