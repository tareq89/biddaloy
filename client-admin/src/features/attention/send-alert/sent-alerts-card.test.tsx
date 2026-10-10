/** [67.5.05] "Sent alerts": seen counts, Withdraw behind a confirm, empty and error states. */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { SentAlertsCard } from './sent-alerts-card';

const alert = (over: Record<string, unknown>) => ({
  id: 'a-1',
  severity: 'WARNING',
  title: 'Fee deadline',
  body: 'Pay',
  actionUrl: null,
  audience: { roles: ['PARENT'] },
  raisedAt: '2026-10-09T05:00:00.000Z',
  expiresAt: '2026-10-12T05:00:00.000Z',
  status: 'ACTIVE',
  createdByName: 'Admin',
  recipientCount: 4,
  seenCount: 3,
  ...over,
});

function renderCard() {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: SentAlertsCard,
  });
  renderWithRouter(root.addChildren([index]), {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('SentAlertsCard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows "seen 3 / 4" and withdraws only after confirming', async () => {
    const user = userEvent.setup();
    let deleted = '';
    server.use(
      http.get('*/attention/manual', () =>
        HttpResponse.json({
          items: [
            alert({}),
            alert({ id: 'a-2', title: 'Old one', status: 'WITHDRAWN', seenCount: 0 }),
          ],
          total: 2,
        }),
      ),
      http.delete('*/attention/manual/:id', ({ params }) => {
        deleted = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderCard();

    expect(await screen.findByText(/^[3৩] \/ [4৪]$/)).toBeTruthy();
    // Only the ACTIVE row has an action.
    expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/^It disappears from [4৪] people's bars\.$/)).toBeTruthy();
    expect(deleted).toBe('');
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(deleted).toBe('a-1'));
  });

  it('renders the empty state', async () => {
    server.use(http.get('*/attention/manual', () => HttpResponse.json({ items: [], total: 0 })));
    renderCard();
    expect(await screen.findByText('No alerts sent yet')).toBeTruthy();
  });

  it('renders the error state with a retry', async () => {
    server.use(
      http.get('*/attention/manual', () =>
        HttpResponse.json({ statusCode: 400, message: 'bad' }, { status: 400 }),
      ),
    );
    renderCard();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
