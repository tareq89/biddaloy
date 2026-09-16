import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

const RECEIPT = {
  invoice_number: 'INV-2026-000123',
  kind: 'INVOICE',
  issued_date: '2026-09-01',
  school: {
    name: 'Ananta High School',
    address: null,
    logo_url: null,
  },
  students: [
    {
      full_name: 'Rahim Ahmed',
      class_name: null,
      lines: [],
    },
  ],
  totals: { billed: 5000, discount: 500, paid: 4500, change: 0 },
  payment: { method: 'CASH', reference_last4: null, payment_date: '2026-09-01' },
};

/** [16.5.5] — a chrome-free public route reachable with no session, so
 * neither test below registers an `/api/v1/auth/refresh` handler at all
 * (deliberately, not an oversight): if this route ever accidentally
 * calls `apiClient`/`ensureSessionLoaded`, that request has nowhere to
 * land and msw's `onUnhandledRequest: 'error'` (`ui/src/test/setup.ts`)
 * fails the test rather than silently passing. Registering
 * `authHandlers.refreshFailure` here would defeat that — a *handled*
 * 401 response is not an unhandled request, so the assertion "no auth
 * call made" would stop being enforced. */
describe('/i/$token public receipt page', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the receipt for a live token, with no auth call made', async () => {
    server.use(http.get('/api/v1/public/invoices/:token', () => HttpResponse.json(RECEIPT)));

    renderWithRouter(routeTree, { initialEntries: ['/i/live-token'], locale: 'en' });

    await waitFor(() => expect(screen.getByText('INV-2026-000123')).toBeTruthy());
    expect(screen.getByText('Rahim Ahmed')).toBeTruthy();
  });

  it('shows a not-found state for an unknown or revoked token, without retrying', async () => {
    server.use(
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

  it('shows the same not-found state for a 410 (explicitly revoked) token', async () => {
    server.use(
      http.get(
        '/api/v1/public/invoices/:token',
        () =>
          new HttpResponse(
            JSON.stringify({
              statusCode: 410,
              message: 'Gone',
              timestamp: new Date().toISOString(),
              path: '/api/v1/public/invoices/gone-token',
              requestId: 'req-3',
            }),
            { status: 410, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    renderWithRouter(routeTree, { initialEntries: ['/i/gone-token'], locale: 'en' });

    await waitFor(() => expect(screen.getByText("This link isn't valid")).toBeTruthy());
  });

  it('shows a retryable error state (not "link invalid") for a server failure, and retries on click', async () => {
    // `usePublicInvoice` retries a 5xx twice (`shouldRetryQuery`) before
    // settling into `isError` — three failing responses, then a fourth
    // (triggered by the "Try again" click) succeeds.
    let callCount = 0;
    server.use(
      http.get('/api/v1/public/invoices/:token', () => {
        callCount += 1;
        return callCount <= 3
          ? new HttpResponse(
              JSON.stringify({
                statusCode: 500,
                message: 'boom',
                timestamp: new Date().toISOString(),
                path: '/api/v1/public/invoices/flaky-token',
                requestId: 'req-2',
              }),
              { status: 500, headers: { 'Content-Type': 'application/json' } },
            )
          : HttpResponse.json(RECEIPT);
      }),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, { initialEntries: ['/i/flaky-token'], locale: 'en' });

    await waitFor(() => expect(screen.getByText("Couldn't load this receipt")).toBeTruthy(), {
      timeout: 10_000,
    });
    expect(screen.queryByText("This link isn't valid")).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText('INV-2026-000123')).toBeTruthy());
  }, 15_000);
});
