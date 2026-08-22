import { afterEach, describe, expect, it } from 'vitest';

import { clearAuthState, getActiveTenant, setActiveTenant } from './auth-state';
import {
  clearNotifications,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  pushNotification,
} from './notification-state';

describe('notification-state', () => {
  afterEach(() => {
    clearNotifications();
    clearAuthState();
  });

  it('starts empty', () => {
    expect(getNotifications()).toEqual([]);
    expect(getUnreadNotificationCount()).toBe(0);
  });

  it('pushNotification prepends a new, unread record with a generated id/timestamp', () => {
    pushNotification({ tenantId: null, message: 'Bulk import finished', variant: 'success' });

    const [notification] = getNotifications();
    expect(notification?.message).toBe('Bulk import finished');
    expect(notification?.variant).toBe('success');
    expect(notification?.read).toBe(false);
    expect(notification?.id).toEqual(expect.any(String));
    expect(notification?.createdAt).toEqual(expect.any(String));
  });

  it('newest notification is first', () => {
    pushNotification({ tenantId: null, message: 'First', variant: 'info' });
    pushNotification({ tenantId: null, message: 'Second', variant: 'info' });

    expect(getNotifications().map((n) => n.message)).toEqual(['Second', 'First']);
  });

  it('caps history at 50, dropping the oldest', () => {
    for (let i = 0; i < 55; i++) {
      pushNotification({ tenantId: null, message: `Notification ${i}`, variant: 'info' });
    }

    const notifications = getNotifications();
    expect(notifications).toHaveLength(50);
    // Newest (54) first, oldest kept is 5 — 0..4 were dropped.
    expect(notifications[0]?.message).toBe('Notification 54');
    expect(notifications[49]?.message).toBe('Notification 5');
  });

  it('markNotificationRead marks only the matching id', () => {
    pushNotification({ tenantId: null, message: 'First', variant: 'info' });
    pushNotification({ tenantId: null, message: 'Second', variant: 'info' });
    const [second, first] = getNotifications();

    markNotificationRead(second!.id);

    const notifications = getNotifications();
    expect(notifications.find((n) => n.id === second!.id)?.read).toBe(true);
    expect(notifications.find((n) => n.id === first!.id)?.read).toBe(false);
    expect(getUnreadNotificationCount()).toBe(1);
  });

  it('markAllNotificationsRead clears every unread flag', () => {
    pushNotification({ tenantId: null, message: 'First', variant: 'info' });
    pushNotification({ tenantId: null, message: 'Second', variant: 'error' });

    markAllNotificationsRead();

    expect(getUnreadNotificationCount()).toBe(0);
    expect(getNotifications().every((n) => n.read)).toBe(true);
  });

  it('a tenant switch clears history so one school cannot see another’s notifications', () => {
    setActiveTenant('tenant-a');
    pushNotification({
      tenantId: 'tenant-a',
      message: "Tenant A's import finished",
      variant: 'success',
    });
    expect(getNotifications()).toHaveLength(1);

    setActiveTenant('tenant-b');

    expect(getNotifications()).toEqual([]);
  });

  it('logout (clearAuthState) also clears history', () => {
    setActiveTenant('tenant-a');
    pushNotification({ tenantId: 'tenant-a', message: 'Something happened', variant: 'info' });
    expect(getNotifications()).toHaveLength(1);

    clearAuthState();

    expect(getNotifications()).toEqual([]);
  });

  it('drops a notification whose captured tenant no longer matches the active tenant', () => {
    // Mirrors an async op (a bulk import, a reminder batch) that started
    // under tenant A but only resolves after the user has switched to
    // tenant B — the outcome belongs to a panel that's no longer active.
    setActiveTenant('tenant-a');
    const capturedTenantId = getActiveTenant();

    setActiveTenant('tenant-b');
    pushNotification({
      tenantId: capturedTenantId,
      message: "Tenant A's import finished",
      variant: 'success',
    });

    expect(getNotifications()).toEqual([]);
  });
});
