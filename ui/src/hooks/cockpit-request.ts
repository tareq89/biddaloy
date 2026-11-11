import axios, { type AxiosRequestConfig } from 'axios';

import { getAccessToken } from '../api/auth-state';
import { API_BASE_URL, toApiError } from '../api/client';

/**
 * Every cockpit call goes through here, not `apiClient`: an owner has no school, and
 * `apiClient` refuses to send without an active tenant (`NoActiveTenantError`). Same
 * reason `postAuthLogin` and `withSession` in `api/client.ts` use plain axios.
 * `withCredentials` so the httpOnly refresh cookie is set/sent; failures come out as `ApiError`.
 * ponytail: no 401 refresh-retry here; `api/session.ts` refreshes the token ahead of expiry.
 */
export async function cockpitRequest<T = void>(
  config: Omit<AxiosRequestConfig, 'headers'> & { headers?: Record<string, string> | undefined },
): Promise<T> {
  const token = getAccessToken();
  try {
    const response = await axios.request<T>({
      baseURL: API_BASE_URL,
      withCredentials: true,
      ...config,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...config.headers },
    });
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
}
