import {
  clearNotifications,
  pushNotification,
  setActiveTenant,
  type NotificationVariant,
} from '@biddaloy/ui/api';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

function seed(message: string, variant: NotificationVariant = 'success') {
  // The tenant must be active *before* the push — `pushNotification`
  // drops a record whose tenant doesn't match `getActiveTenant()`, and
  // `renderWithRouter`'s own `tenantId` option only takes effect once the
  // render call runs, which is after this in every test below.
  setActiveTenant('tenant-1');
  pushNotification({ tenantId: 'tenant-1', message, variant });
}

function renderNotificationsPage() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/notifications'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/notifications', () => {
  afterEach(async () => {
    clearNotifications();
    await cleanupTestState();
  });

  it('renders the EmptyState, with no list and no "mark all read", when there are none', async () => {
    renderNotificationsPage();

    expect(await screen.findByRole('heading', { level: 2, name: 'No notifications' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
    expect(screen.queryByText("You're all caught up.")).toBeNull();
  });

  it('shows one h1 and the unread count in the subtitle only while something is unread', async () => {
    const user = userEvent.setup();
    seed('First finished');
    seed('Second finished');
    renderNotificationsPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeTruthy();
    expect(screen.getByText(/2 unread/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(screen.queryByText(/unread/)).toBeNull());
  });

  it('lists the session history, newest first', async () => {
    seed('First finished');
    seed('Second finished');
    renderNotificationsPage();

    // Scoped to `role="button"` rows rather than the page's every
    // `listitem` — the staff sidebar's nav links are `<li>`s too, so an
    // unscoped `getAllByRole('listitem')` would count those as well.
    const rows = await screen.findAllByRole('button', { name: /finished/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Second finished');
    expect(rows[1]?.textContent).toContain('First finished');
  });

  it('marks a single notification read when its row is activated', async () => {
    const user = userEvent.setup();
    seed('Bulk import finished');
    renderNotificationsPage();

    const row = await screen.findByRole('button', { name: /Bulk import finished/ });
    await user.click(row);

    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: /Bulk import finished/ }).disabled,
      ).toBe(true);
    });
  });

  it('"mark all read" marks every row read, then disappears', async () => {
    const user = userEvent.setup();
    seed('First finished');
    seed('Second finished');
    renderNotificationsPage();

    await user.click(await screen.findByRole('button', { name: 'Mark all read' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull());
    for (const row of screen.getAllByRole<HTMLButtonElement>('button', { name: /finished/ })) {
      expect(row.disabled).toBe(true);
    }
  });

  it('has no accessibility violations', async () => {
    seed('Bulk import finished');
    const { container } = renderNotificationsPage();
    await screen.findByText('Bulk import finished');

    await expect(container).toHaveNoViolations();
  });
});
