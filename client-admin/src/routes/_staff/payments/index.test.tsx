/**
 * [16.4.4]'s placeholder payments page (C1) — real route tree, per
 * `bulk-reminder-wizard.test.tsx`'s own convention. The two things that
 * matter: `?record=1` opens the modal on load (so a refresh or a shared
 * link survives), and the Record payment button sets it.
 */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
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

describe('/payments', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('[16.4.4] does not open the modal without ?record=1', async () => {
    const { localeReady } = render(['/payments']);
    await localeReady;

    await screen.findByText(/A payments list with filters and detail/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the modal when ?record=1 is present on load', async () => {
    server.use(
      http.get('/api/v1/payments/cart', () =>
        HttpResponse.json({
          students: [],
          total_balance: 0,
          suggested: { allocations: [], wallet_used: 0, remaining: 0, to_wallet: 0 },
        }),
      ),
    );

    const { localeReady } = render(['/payments?record=1&student_id=student-1']);
    await localeReady;

    await screen.findByRole('dialog');
  });

  it('the Record payment button sets ?record=1', async () => {
    const user = userEvent.setup();
    const { localeReady, router } = render(['/payments']);
    await localeReady;

    await user.click((await screen.findAllByRole('button', { name: 'Record payment' }))[0]!);

    expect(router.state.location.search.record).toBe('1');
  });
});
