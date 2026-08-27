/**
 * Generated OpenAPI types and the shared axios client.
 */
export { apiClient } from './client';
export {
  ApiError,
  NoActiveTenantError,
  NoMembershipsError,
  RateLimitedError,
  type ApiErrorBody,
} from './errors';
export { createAppQueryClient } from './query-client';
export {
  clearAuthState,
  getAccessToken,
  getActiveRole,
  getActiveTenant,
  registerSessionExpiredHandler,
  setAccessToken,
  setActiveRole,
  setActiveTenant,
  subscribeAuthState,
} from './auth-state';
export { clearApiCache } from './sw-cache';
export {
  decodeAccessTokenMemberships,
  ensureSessionLoaded,
  resetSessionBootstrap,
  scheduleTokenRefresh,
} from './session';
export {
  clearNotifications,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  pushNotification,
  subscribeNotificationState,
  type NotificationRecord,
  type NotificationVariant,
} from './notification-state';
export {
  captureRouteError,
  initSentry,
  updateSentryRouteTag,
  updateSentryTenantTag,
  type InitSentryOptions,
} from './sentry';
export type { paths, components, operations } from './schema';
