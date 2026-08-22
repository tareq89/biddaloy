import * as React from 'react';

import {
  getNotifications,
  getUnreadNotificationCount,
  subscribeNotificationState,
  type NotificationRecord,
} from '../api/notification-state';

/**
 * Reactive counterparts to `notification-state.ts`'s plain getters, built
 * on `useSyncExternalStore` over that module's `subscribeNotificationState`
 * — same shape as `auth-state.ts`'s `useActiveTenant`/`useActiveRole`
 * (`./auth-state.ts`). A push, a mark-read, or a tenant-switch clear
 * re-renders every component reading one of these.
 */
export function useNotifications(): readonly NotificationRecord[] {
  return React.useSyncExternalStore(subscribeNotificationState, getNotifications);
}

export function useUnreadNotificationCount(): number {
  return React.useSyncExternalStore(subscribeNotificationState, getUnreadNotificationCount);
}
