/**
 * Generated OpenAPI types and the shared axios client.
 */
export { apiClient } from './client';
export { ApiError, NoActiveTenantError, type ApiErrorBody } from './errors';
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
export type { paths, components, operations } from './schema';
