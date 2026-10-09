import { alertItemFactory, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

function render(path: string) {
  return renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/notifications', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the To-do tab by default under one h1', async () => {
    server.use(
      http.get('*/attention/items', () =>
        HttpResponse.json({ items: [alertItemFactory({ title: 'Do this' })], total: 1 }),
      ),
    );
    render('/notifications');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Alerts & notifications' }),
    ).toBeTruthy();
    expect(await screen.findByText('Do this')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /To-do/, selected: true })).toBeTruthy();
  });

  it('opens History from ?tab=history', async () => {
    render('/notifications?tab=history');
    expect(await screen.findByRole('tab', { name: 'History', selected: true })).toBeTruthy();
  });

  it('drops the filters when the tab changes', async () => {
    const user = userEvent.setup();
    const { router } = render('/notifications?category=HOMEWORK&page=2');

    await user.click(await screen.findByRole('tab', { name: 'History' }));

    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'history' }));
  });
});
