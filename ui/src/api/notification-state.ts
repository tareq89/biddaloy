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
 *
 * [31.2.11] History is persisted in `localStorage` per user + school (D4) and
 * every stored key is purged at logout, like `form-draft-storage.ts`.
 */
import {
  currentSessionGeneration,
  getAccessToken,
  getActiveTenant,
  subscribeAuthState,
} from './auth-state';
import { decodeAccessTokenSubject } from './session';

export type NotificationVariant = 'success' | 'error' | 'info';

export interface NotificationRecord {
  id: string;
  /** The tenant active when the underlying operation *started*, not when
   * it finished — an async outcome (a bulk import, a reminder batch) can
   * resolve after the user has switched tenants, and `pushNotification`
   * drops it rather than let one school's outcome land in another's
   * panel. Callers must capture `getActiveTenant()` up front, not read it
   * again at push time. */
  tenantId: string | null;
  /** Already-translated/human text — same discipline as `ErrorState`'s
   * `message` (`../components/error-state.tsx`): a caller passes a string
   * meant to be read, never a raw `Error`/API payload. */
  message: string;
  createdAt: string;
  read: boolean;
  variant: NotificationVariant;
}

// Unbounded growth is a real concern in a long-lived SPA session. 1000 per
// user + school (D4) is far past what anyone scrolls, and still small enough
// for localStorage.
const MAX_NOTIFICATIONS = 1000;
const STORAGE_PREFIX = 'notifications:v1:';

function storageKey(): string | null {
  const token = getAccessToken();
  const tenantId = getActiveTenant();
  const userId = token ? decodeAccessTokenSubject(token) : null;
  return userId && tenantId ? `${STORAGE_PREFIX}${userId}:${tenantId}` : null;
}

const VARIANTS: readonly string[] = ['success', 'error', 'info'];

function readStored(key: string): NotificationRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    const tenantId = getActiveTenant();
    return (parsed as (Partial<NotificationRecord> | null)[])
      .filter(
        (r: Partial<NotificationRecord> | null): r is NotificationRecord =>
          !!r &&
          typeof r.id === 'string' &&
          typeof r.message === 'string' &&
          typeof r.createdAt === 'string' &&
          typeof r.read === 'boolean' &&
          VARIANTS.includes(r.variant as string) &&
          r.tenantId === tenantId,
      )
      .slice(0, MAX_NOTIFICATIONS);
  } catch {
    return [];
  }
}

// ponytail: last writer wins across tabs; listen for the "storage" event if two open tabs must merge their histories.
function writeStored(): void {
  const key = storageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(notifications));
  } catch {
    // quota or blocked storage: the list just stays in memory.
  }
}

function purgeStored(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // blocked storage: nothing to purge.
  }
}

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
  // The operation's own captured tenant, not this module's — a tenant
  // switch between when an async op started and when it resolved means
  // `input.tenantId` and `getActiveTenant()` disagree, and the outcome
  // belongs to a panel the user has since navigated away from.
  if (input.tenantId !== getActiveTenant()) return;

  const record: NotificationRecord = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    read: false,
  };
  notifications = [record, ...notifications].slice(0, MAX_NOTIFICATIONS);
  writeStored();
  notifyNotificationStateChange();
}

export function markNotificationRead(id: string): void {
  notifications = notifications.map((notification) =>
    notification.id === id ? { ...notification, read: true } : notification,
  );
  writeStored();
  notifyNotificationStateChange();
}

export function markAllNotificationsRead(): void {
  notifications = notifications.map((notification) => ({ ...notification, read: true }));
  writeStored();
  notifyNotificationStateChange();
}

export function clearNotifications(): void {
  notifications = [];
  writeStored();
  notifyNotificationStateChange();
}

// Auth changes swap the in-memory list for the new user + school's stored one
// (empty when there is none), so one school's records are never in memory
// while another is active. A session-generation bump (logout, expiry, failed
// refresh) also purges every stored key: the next person at this browser must
// not see them.
let lastKey = storageKey();
let lastTenant = getActiveTenant();
let lastGeneration = currentSessionGeneration();
notifications = lastKey ? readStored(lastKey) : [];
subscribeAuthState(() => {
  const sessionEnded = currentSessionGeneration() !== lastGeneration;
  if (sessionEnded) {
    lastGeneration = currentSessionGeneration();
    purgeStored();
  }
  const key = storageKey();
  const tenant = getActiveTenant();
  // Tenant is compared too: with no signed-in user the key is null, but a school switch must still empty the list.
  // A session end always reloads, even when key and tenant were already null.
  if (!sessionEnded && key === lastKey && tenant === lastTenant) return;
  lastKey = key;
  lastTenant = tenant;
  notifications = key ? readStored(key) : [];
  notifyNotificationStateChange();
});
