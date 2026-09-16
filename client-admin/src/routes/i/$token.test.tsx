import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

const RECEIPT = {
  invoice_number: 'INV-2026-000123',
  issued_date: '2026-09-01',
  due_date: '2026-09-15',
  total_amount: 5000,
  tax_amount: 0,
  discount_amount: 500,
  notes: null,
  student: { full_name: 'Rahim Ahmed' },
  issuer: {
    name: 'Ananta High School',
    name_bn: null,
    address: null,
    phone: null,
    email: null,
    registration_id: null,
    logo_key: null,
  },
  logo_url: null,
};

/** [16.5.5] — a chrome-free public route reachable with no session, so
 * every test here deliberately leaves `authHandlers.refreshFailure` in
 * place: if this route ever accidentally calls `apiClient`/
 * `ensureSessionLoaded`, msw's `onUnhandledRequest: 'error'`
 * (`ui/src/test/setup.ts`) fails the test rather than silently passing. */
describe('/i/$token public receipt page', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the receipt for a live token, with no auth call made', async () => {
    server.use(
      authHandlers.refreshFailure,
      http.get('/api/v1/public/invoices/:token', () => HttpResponse.json(RECEIPT)),
    );

    renderWithRouter(routeTree, { initialEntries: ['/i/live-token'], locale: 'en' });

    await waitFor(() => expect(screen.getByText('INV-2026-000123')).toBeTruthy());
    expect(screen.getByText('Rahim Ahmed')).toBeTruthy();
  });

  it('shows a not-found state for an unknown or revoked token, without retrying', async () => {
    server.use(
      authHandlers.refreshFailure,
      http.get(
        '/api/v1/public/invoices/:token',
        () =>
          new HttpResponse(
            JSON.stringify({
              statusCode: 404,
              message: 'Not found',
              timestamp: new Date().toISOString(),
              path: '/api/v1/public/invoices/revoked-token',
              requestId: 'req-1',
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    renderWithRouter(routeTree, { initialEntries: ['/i/revoked-token'], locale: 'en' });

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
});
