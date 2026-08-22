import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { clearNotifications, pushNotification } from '../api/notification-state';

import { NotificationBell } from './notification-bell';

describe('NotificationBell', () => {
  afterEach(() => {
    clearNotifications();
  });

  it('has no unread badge and shows the empty state when there is no history', async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);

    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText("You're all caught up.")).toBeTruthy();
  });

  it('shows an unread count in the trigger’s accessible name, and lists history in the panel', async () => {
    const user = userEvent.setup();
    pushNotification({ message: 'Bulk import finished', variant: 'success' });
    pushNotification({ message: 'SMS delivery failed', variant: 'error' });
    render(<NotificationBell />);

    const trigger = screen.getByRole('button', { name: 'Notifications, 2 unread' });
    await user.click(trigger);

    expect(await screen.findByText('Bulk import finished')).toBeTruthy();
    expect(screen.getByText('SMS delivery failed')).toBeTruthy();
  });

  it('marking a single notification read updates the unread count', async () => {
    const user = userEvent.setup();
    pushNotification({ message: 'Bulk import finished', variant: 'success' });
    render(<NotificationBell />);

    await user.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));
    await user.click(await screen.findByRole('button', { name: /Bulk import finished/ }));

    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy();
  });

  it('"mark all read" clears the unread count and is disabled once nothing is unread', async () => {
    const user = userEvent.setup();
    pushNotification({ message: 'First', variant: 'info' });
    pushNotification({ message: 'Second', variant: 'info' });
    render(<NotificationBell />);

    await user.click(screen.getByRole('button', { name: 'Notifications, 2 unread' }));
    const markAllRead = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Mark all read',
    });
    expect(markAllRead.disabled).toBe(false);

    await user.click(markAllRead);

    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Mark all read' }).disabled).toBe(
      true,
    );
  });

  it('trigger is reachable by Tab and opens the panel on Enter', async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Notifications' }));

    await user.keyboard('{Enter}');
    expect(await screen.findByText("You're all caught up.")).toBeTruthy();
  });

  it('is axe clean, both closed and with the panel open showing history', async () => {
    const user = userEvent.setup();
    pushNotification({ message: 'Bulk import finished', variant: 'success' });
    const { baseElement } = render(<NotificationBell />);
    await expect(baseElement).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));
    await screen.findByText('Bulk import finished');
    // Panel content is portaled to `document.body`, outside `container` —
    // `baseElement` (the portal's actual root) is what needs to be axe clean.
    await expect(baseElement).toHaveNoViolations();
  });
});
