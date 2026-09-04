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

  it('renders the empty state when the session has no notifications', async () => {
    renderNotificationsPage();

    expect(await screen.findByText("You're all caught up.")).toBeTruthy();
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

  it('disables "mark all read" when nothing is unread, and clears the unread count when used', async () => {
    const user = userEvent.setup();
    seed('First finished');
    seed('Second finished');
    renderNotificationsPage();

    const markAllRead = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Mark all read',
    });
    expect(markAllRead.disabled).toBe(false);

    await user.click(markAllRead);

    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Mark all read' }).disabled,
      ).toBe(true);
    });
  });

  it('has no accessibility violations', async () => {
    seed('Bulk import finished');
    const { container } = renderNotificationsPage();
    await screen.findByText('Bulk import finished');

    await expect(container).toHaveNoViolations();
  });
});
