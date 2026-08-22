/**
 * [8.9.8]'s notification-centre history — the bell's in-session record of
 * async outcomes (a bulk import finishing, a reminder batch completing, an
 * SMS delivery failing) a user might have missed while on another screen.
 * Toasts (`../components/toast.tsx`) give immediate feedback; this is the
 * separate, longer-lived list the bell reads from.
 *
 * Same plain module-scoped holder shape as `auth-state.ts` — see that
 * module's own header comment for why this isn't a Zustand/Context store.
 * A future ticket can back this with a real store without changing this
 * module's public surface.
 */
import { getActiveTenant, subscribeAuthState } from './auth-state';

export type NotificationVariant = 'success' | 'error' | 'info';

export interface NotificationRecord {
  id: string;
  /** Already-translated/human text — same discipline as `ErrorState`'s
   * `message` (`../components/error-state.tsx`): a caller passes a string
   * meant to be read, never a raw `Error`/API payload. */
  message: string;
  createdAt: string;
  read: boolean;
  variant: NotificationVariant;
}

// Unbounded growth is a real concern in a long-lived SPA session — same
// care `use-route-focus.ts`'s module-level anchor map takes. 50 is well
// past what a bell panel usefully shows before "mark all read" is the
// obvious next action anyway.
const MAX_NOTIFICATIONS = 50;

let notifications: NotificationRecord[] = [];

const listeners = new Set<() => void>();

function notifyNotificationStateChange(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeNotificationState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNotifications(): readonly NotificationRecord[] {
  return notifications;
}

export function getUnreadNotificationCount(): number {
  return notifications.reduce((count, notification) => count + (notification.read ? 0 : 1), 0);
}

export function pushNotification(
  input: Omit<NotificationRecord, 'id' | 'createdAt' | 'read'>,
): void {
  const record: NotificationRecord = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    read: false,
  };
  notifications = [record, ...notifications].slice(0, MAX_NOTIFICATIONS);
  notifyNotificationStateChange();
}

export function markNotificationRead(id: string): void {
  notifications = notifications.map((notification) =>
    notification.id === id ? { ...notification, read: true } : notification,
  );
  notifyNotificationStateChange();
}

export function markAllNotificationsRead(): void {
  notifications = notifications.map((notification) => ({ ...notification, read: true }));
  notifyNotificationStateChange();
}

export function clearNotifications(): void {
  notifications = [];
  notifyNotificationStateChange();
}

// A tenant switch (or logout, which clears the active tenant too) must not
// let one school's async-outcome history leak into another's bell — the
// same tenant-isolation instinct as `clearAuthState()`'s own tenant
// cleanup, just applied to this module's separate piece of state rather
// than folded into that function directly (this module stays decoupled
// from auth-state's internals, only subscribing to its change feed).
let lastSeenTenantId: string | null = getActiveTenant();
subscribeAuthState(() => {
  const activeTenantId = getActiveTenant();
  if (activeTenantId !== lastSeenTenantId) {
    lastSeenTenantId = activeTenantId;
    clearNotifications();
  }
});
