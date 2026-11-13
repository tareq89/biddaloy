import axios, { type AxiosRequestConfig } from 'axios';

import { getAccessToken, notifySessionExpired } from '../api/auth-state';
import { API_BASE_URL, toApiError } from '../api/client';
import { RateLimitedError } from '../api/errors';

/**
 * Every cockpit call goes through here, not `apiClient`: an owner has no school, and
 * `apiClient` refuses to send without an active tenant (`NoActiveTenantError`). Same
 * reason `postAuthLogin` and `withSession` in `api/client.ts` use plain axios.
 * `withCredentials` so the httpOnly refresh cookie is set/sent; failures come out as `ApiError`, a 429 as `RateLimitedError`.
 * ponytail: no 401 refresh-retry here; `api/session.ts` refreshes the token ahead of expiry.
 *
 * A 401 on a signed-in call means the server ended the session (its idle clock is not the
 * browser's), so it goes to the one session-expired handler (back to `/sign-in`). Not for the
 * step-up code check: a wrong code is a 401 there and must stay an ordinary error.
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
    if (
      token &&
      // A newer sign-in replaced this call's token: its 401 is about the old session.
      getAccessToken() === token &&
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !config.headers?.Authorization &&
      !config.url?.startsWith('/platform/step-up')
    ) {
      notifySessionExpired();
    }
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      // Same as `apiClient`: the wait is in the header, not the body.
      const header: unknown = error.response.headers['retry-after'];
      const parsed = typeof header === 'string' ? Number.parseInt(header, 10) : NaN;
      throw new RateLimitedError(Number.isFinite(parsed) ? parsed : null);
    }
    throw toApiError(error);
  }
}
