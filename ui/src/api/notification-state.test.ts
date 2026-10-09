import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearAuthState, getActiveTenant, setAccessToken, setActiveTenant } from './auth-state';
import {
  clearNotifications,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  pushNotification,
} from './notification-state';

function fakeJwt(sub: string): string {
  const payload = btoa(JSON.stringify({ sub }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const storedKeys = () => Object.keys(localStorage).filter((k) => k.startsWith('notifications:v1:'));

describe('notification-state', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearNotifications();
    clearAuthState();
    localStorage.clear();
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

  it('caps history at 1000, dropping the oldest', () => {
    for (let i = 0; i < 1005; i++) {
      pushNotification({ tenantId: null, message: `Notification ${i}`, variant: 'info' });
    }

    const notifications = getNotifications();
    expect(notifications).toHaveLength(1000);
    // Newest (1004) first, oldest kept is 5 — 0..4 were dropped.
    expect(notifications[0]?.message).toBe('Notification 1004');
    expect(notifications[999]?.message).toBe('Notification 5');
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

  it('logout clears history even when no user or school was set', () => {
    pushNotification({ tenantId: null, message: 'Something happened', variant: 'info' });
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

  describe('persistence', () => {
    const signIn = (sub: string, tenant: string) => {
      setAccessToken(fakeJwt(sub));
      setActiveTenant(tenant);
    };
    const push = (tenantId: string, message: string) =>
      pushNotification({ tenantId, message, variant: 'info' });

    it('writes a push under the user + school key', () => {
      signIn('u1', 'a');
      push('a', 'Hello');
      expect(JSON.parse(localStorage.getItem('notifications:v1:u1:a')!)).toHaveLength(1);
    });

    it('restores a school’s history on switching back, never showing the other’s', () => {
      signIn('u1', 'a');
      push('a', 'A one');
      setActiveTenant('b');
      expect(getNotifications()).toEqual([]);
      push('b', 'B one');
      setActiveTenant('a');
      expect(getNotifications().map((n) => n.message)).toEqual(['A one']);
    });

    it('keeps a separate list per user', () => {
      signIn('u1', 'a');
      push('a', 'U1');
      setAccessToken(fakeJwt('u2'));
      expect(getNotifications()).toEqual([]);
    });

    it('keeps the list when a token refresh keeps the same user', () => {
      signIn('u1', 'a');
      push('a', 'Keep');
      setAccessToken(fakeJwt('u1') + 'x');
      expect(getNotifications()).toHaveLength(1);
    });

    it('logout removes every stored key', () => {
      signIn('u1', 'a');
      push('a', 'Bye');
      setActiveTenant('b');
      push('b', 'Bye too');
      expect(storedKeys()).toHaveLength(2);
      clearAuthState();
      expect(getNotifications()).toEqual([]);
      expect(storedKeys()).toEqual([]);
    });

    it('ignores corrupt storage and records for another tenant', () => {
      localStorage.setItem('notifications:v1:u1:a', '{not json');
      signIn('u1', 'a');
      expect(getNotifications()).toEqual([]);

      const rec = (tenantId: string) => ({
        id: tenantId,
        tenantId,
        message: 'm',
        createdAt: new Date().toISOString(),
        read: false,
        variant: 'info',
      });
      localStorage.setItem('notifications:v1:u1:c', JSON.stringify([rec('c'), rec('other')]));
      setActiveTenant('c');
      expect(getNotifications().map((n) => n.id)).toEqual(['c']);
    });

    it('still works in memory when storage throws', () => {
      signIn('u1', 'a');
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      push('a', 'Memory only');
      expect(getNotifications()).toHaveLength(1);
    });
  });
});
