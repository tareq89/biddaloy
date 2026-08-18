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
} from './auth-state';
export { ensureSessionLoaded, resetSessionBootstrap, scheduleTokenRefresh } from './session';
export type { paths, components, operations } from './schema';
