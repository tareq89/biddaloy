import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

import {
  getAccessToken,
  getActiveRole,
  getActiveTenant,
  notifySessionExpired,
  setAccessToken,
} from './auth-state';
import { ApiError, type ApiErrorBody, NoActiveTenantError } from './errors';

/** Matches server/src/main.ts's global prefix ("api") + URI versioning
 * ("v1"). Relative, not absolute: Vite's dev proxy forwards /api to the
 * local Nest server, and production serves everything same-origin — see
 * client-admin's vite.config.ts and server/src/main.ts's static-serving. */
const API_BASE_URL = '/api/v1';

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

export const apiClient = axios.create({ baseURL: API_BASE_URL });

apiClient.interceptors.request.use((config) => {
  const tenantId = getActiveTenant();
  if (!tenantId) {
    // Rejecting here means the request is never dispatched — axios has not
    // yet handed the config to its adapter, so no HTTP call happens.
    return Promise.reject(new NoActiveTenantError());
  }

  config.headers.set('X-Tenant-ID', tenantId);

  const role = getActiveRole();
  if (role) {
    config.headers.set('X-Role', role);
  }

  const token = getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }

  return config;
});

/** Single-flight refresh: the first 401 creates this promise; every
 * concurrent 401 that arrives before it settles awaits the same one instead
 * of issuing its own POST /auth/refresh. The server treats a second refresh
 * request presenting an already-rotated cookie as reuse outside its grace
 * window — see refresh-token.service.ts's TOKEN_REUSE_DETECTED path — so
 * this is not just an optimization, it is what keeps a page that fires
 * several parallel requests on an expired token from tripping that audit
 * path and getting its whole token family revoked. */
let refreshPromise: Promise<string> | null = null;

async function performRefresh(): Promise<string> {
  try {
    // Plain `axios`, not `apiClient`: going through apiClient would re-enter
    // its own request interceptor, which throws NoActiveTenantError when no
    // tenant is set. A refresh must be able to succeed even if the active
    // tenant got cleared for some unrelated reason — the refresh endpoint
    // doesn't need X-Tenant-ID/X-Role/Authorization at all, so bypassing
    // that interceptor entirely is correct, not an oversight.
    //
    // withCredentials: the refresh token is an httpOnly, SameSite=strict
    // cookie the server sets on login/refresh — this client never reads or
    // stores it directly. No request body; the cookie is the credential.
    const response = await axios.post<{ access_token: string }>(
      `${API_BASE_URL}/auth/refresh`,
      undefined,
      { withCredentials: true },
    );
    const token = response.data.access_token;
    setAccessToken(token);
    return token;
  } catch (err) {
    notifySessionExpired();
    throw err;
  } finally {
    refreshPromise = null;
  }
}

function refreshAccessToken(): Promise<string> {
  refreshPromise ??= performRefresh();
  return refreshPromise;
}

function toApiError(error: unknown): unknown {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as Partial<ApiErrorBody> | undefined;
    if (
      body &&
      typeof body.statusCode === 'number' &&
      typeof body.message === 'string' &&
      typeof body.requestId === 'string'
    ) {
      return new ApiError(body as ApiErrorBody);
    }
  }
  return error;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;

    // No isRefreshCall guard: the refresh request never goes through
    // apiClient (see performRefresh's own comment on why), so this
    // interceptor never actually observes a 401 from /auth/refresh — only
    // `_retry` below does the real work of stopping a repeat 401 after
    // replay from refreshing a second time.
    if (error.response?.status === 401 && config && !config._retry) {
      config._retry = true;
      try {
        await refreshAccessToken();
        // Re-dispatching the same config re-enters the request interceptor
        // above, which reads the just-refreshed token from getAccessToken()
        // itself — no need to set the header here.
        return apiClient(config);
      } catch {
        // performRefresh() already cleared auth state and notified the
        // consuming app; surface the original 401, not the refresh's own
        // error, since that is what the caller actually asked for.
        return Promise.reject(toApiError(error));
      }
    }

    return Promise.reject(toApiError(error));
  },
);
