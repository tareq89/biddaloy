import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

function render(initialEntries: string[]) {
  return renderWithRouter(routeTree, {
    initialEntries,
    tenantId: 'tenant-1',
    role: 'ACCOUNTANT',
    locale: 'en',
  });
}

function mockPayments() {
  server.use(
    http.get('/api/v1/payments', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 25 }),
    ),
    http.get('/api/v1/payments/cart', () =>
      HttpResponse.json({
        students: [],
        total_balance: 0,
        suggested: { allocations: [], wallet_used: 0, remaining: 0, to_wallet: 0 },
      }),
    ),
  );
}

describe('/payments/record', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the full-page form with a Close button', async () => {
    mockPayments();
    const { localeReady, router } = render(['/payments/record?student_id=s1']);
    await localeReady;

    expect(
      (await screen.findByRole('heading', { level: 1, name: 'Record a payment' })).textContent,
    ).toBe('Record a payment');
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/payments/record');
  });

  it('Close with nothing typed goes back to /payments without asking', async () => {
    mockPayments();
    const user = userEvent.setup();
    const { localeReady, router } = render(['/payments/record?student_id=s1']);
    await localeReady;

    await user.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/payments'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
