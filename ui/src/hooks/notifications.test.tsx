import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { clearNotifications, pushNotification } from '../api/notification-state';

import { useNotifications, useUnreadNotificationCount } from './notifications';

function NotificationsProbe() {
  const notifications = useNotifications();
  const unreadCount = useUnreadNotificationCount();
  return (
    <div>
      <p>unread: {unreadCount}</p>
      <ul>
        {notifications.map((notification) => (
          <li key={notification.id}>{notification.message}</li>
        ))}
      </ul>
    </div>
  );
}

describe('useNotifications / useUnreadNotificationCount', () => {
  afterEach(() => {
    clearNotifications();
  });

  it('reflects the current notification list and re-renders on push', () => {
    render(<NotificationsProbe />);
    expect(screen.queryByText('Bulk import finished')).toBeNull();

    act(() => {
      pushNotification({ message: 'Bulk import finished', variant: 'success' });
    });

    expect(screen.getByText('Bulk import finished')).toBeTruthy();
  });

  it('reflects the unread count and re-renders on push', () => {
    render(<NotificationsProbe />);
    expect(screen.getByText('unread: 0')).toBeTruthy();

    act(() => {
      pushNotification({ message: 'Reminder batch completed', variant: 'info' });
      pushNotification({ message: 'SMS delivery failed', variant: 'error' });
    });

    expect(screen.getByText('unread: 2')).toBeTruthy();
  });
});
