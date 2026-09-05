import type { LoginResponse } from '@biddaloy/shared';
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

import {
  currentSessionGeneration,
  getAccessToken,
  getActiveRole,
  getActiveTenant,
  notifySessionExpired,
  setAccessToken,
} from './auth-state';
import { ApiError, type ApiErrorBody, NoActiveTenantError, RateLimitedError } from './errors';

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

/** The raw refresh call, no single-flight guard and no failure handling —
 * `ui/src/api/session.ts`'s cold-boot and pre-expiry refresh call this
 * directly (their own separate single-flight lock, no `notifySessionExpired`
 * on failure: a cold-boot "no session yet" outcome is routine, not a
 * "your session just ended" event — see that module's own comment). The
 * interceptor below wraps this same function with its own single-flight
 * lock and the notify-on-failure behavior a genuine mid-session 401
 * warrants.
 *
 * Plain `axios`, not `apiClient`: going through apiClient would re-enter
 * its own request interceptor, which throws NoActiveTenantError when no
 * tenant is set. A refresh must be able to succeed even if the active
 * tenant got cleared for some unrelated reason — the refresh endpoint
 * doesn't need X-Tenant-ID/X-Role/Authorization at all, so bypassing
 * that interceptor entirely is correct, not an oversight.
 *
 * withCredentials: the refresh token is an httpOnly, SameSite=strict
 * cookie the server sets on login/refresh — this client never reads or
 * stores it directly. No request body; the cookie is the credential.
 *
 * Session-generation guard: captures the generation before the network
 * call and only applies the result if it's still current. Without this, a
 * refresh already in flight when a logout (or a failed sibling refresh)
 * resets the session could resolve afterward and silently restore an
 * access token the reset just cleared — see `auth-state.ts`'s
 * `currentSessionGeneration`. The token is still returned either way;
 * only the global `setAccessToken` side effect is guarded.
 *
 * Returns the full `LoginResponse`, not just `access_token` — the server
 * already sends fresh `memberships` (name included, see
 * `JwtMembership.name`) alongside every refresh; `ui/src/api/session.ts`'s
 * cold-boot bootstrap decodes them to restore [8.9.5]'s persisted active
 * tenant, which a token-only return couldn't support. */
export async function postAuthRefresh(): Promise<LoginResponse> {
  const generation = currentSessionGeneration();
  const response = await axios.post<LoginResponse>(`${API_BASE_URL}/auth/refresh`, undefined, {
    withCredentials: true,
  });
  if (currentSessionGeneration() === generation) {
    setAccessToken(response.data.access_token);
  }
  return response.data;
}

/** `/auth/logout` and `/auth/logout-all`, bypassing `apiClient`'s tenant
 * requirement — same reason `postAuthRefresh` bypasses it (see above): a
 * session restored from a cold-boot refresh can have an access token
 * before the user has picked a tenant, and `apiClient`'s request
 * interceptor rejects with `NoActiveTenantError` *before dispatching*
 * when no tenant is active. Going through `apiClient` for logout would
 * mean that request never reaches the server at all in that window — the
 * refresh cookie stays valid server-side, and a later cold boot silently
 * restores the "logged out" session.
 *
 * Attaches the Authorization header manually (only `apiClient`'s request
 * interceptor normally does that) since `/auth/logout-all` needs it;
 * `/auth/logout` doesn't require it but accepts it harmlessly. Plain
 * `axios`, `withCredentials: true`, matching `postAuthRefresh` — the
 * refresh cookie is `/auth/logout`'s actual credential. */
export async function postAuthLogout(endpoint: '/auth/logout' | '/auth/logout-all'): Promise<void> {
  const token = getAccessToken();
  await axios.post(`${API_BASE_URL}${endpoint}`, undefined, {
    withCredentials: true,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
}

/** `POST /auth/login`, bypassing `apiClient` for the same reason
 * `postAuthRefresh`/`postAuthLogout` do — there is no active tenant yet at
 * the point a caller can even attempt this. `withCredentials: true` so the
 * server's `Set-Cookie` (the httpOnly refresh token) is actually stored;
 * `ui/src/hooks/auth.ts`'s `login()` handles everything after the response
 * (setting the access token, arming the proactive refresh timer, picking a
 * tenant) — this function's only job is the network call and turning a 429
 * into something a caller can build a real message from.
 *
 * `credentials` mirrors the server's `LoginDto`: exactly one of `email`/
 * `phone`, both accepted, never both sent — `ui/src/utils/login-identifier.ts`'s
 * `detectLoginIdentifier` is what decides which one a caller sends. */
export async function postAuthLogin(
  credentials: ({ email: string } | { phone: string }) & { password: string },
): Promise<LoginResponse> {
  try {
    const response = await axios.post<LoginResponse>(`${API_BASE_URL}/auth/login`, credentials, {
      withCredentials: true,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      const header: unknown = error.response.headers['retry-after'];
      const parsed = typeof header === 'string' ? Number.parseInt(header, 10) : NaN;
      throw new RateLimitedError(Number.isFinite(parsed) ? parsed : null);
    }
    throw toApiError(error);
  }
}

export interface ActivateVerifyResponse {
  status: 'valid' | 'expired' | 'consumed' | 'revoked' | 'unknown';
  full_name?: string;
  school_name?: string;
}

/** `POST /auth/activate/verify` — read-only, no cookie involved yet: this
 * is the check `activate.tsx` makes on load before showing the set-password
 * form. Bare `axios`, same reason `postAuthLogin` bypasses `apiClient` —
 * there is no tenant, and no session, at this point. Never throws for an
 * expired/consumed/revoked/unknown token — those are 200 responses with a
 * different `status`, per `ActivationService.verify`'s own contract; only a
 * genuine network/429 failure reaches the catch below. */
export async function postAuthActivateVerify(token: string): Promise<ActivateVerifyResponse> {
  try {
    const response = await axios.post<ActivateVerifyResponse>(
      `${API_BASE_URL}/auth/activate/verify`,
      { token },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      const header: unknown = error.response.headers['retry-after'];
      const parsed = typeof header === 'string' ? Number.parseInt(header, 10) : NaN;
      throw new RateLimitedError(Number.isFinite(parsed) ? parsed : null);
    }
    throw toApiError(error);
  }
}

/** `POST /auth/activate` — consumes the invite token, sets the password,
 * and (like `postAuthLogin`) stores the refresh-token cookie via
 * `withCredentials`. A non-`valid` token surfaces as an `ApiError` whose
 * `.message` is the status string (`expired`/`consumed`/`revoked`/
 * `unknown`) — see `ActivationService.activate`'s own comment — which
 * `activate.tsx`'s error mapping matches directly. */
export async function postAuthActivate(input: {
  token: string;
  password: string;
}): Promise<LoginResponse> {
  try {
    const response = await axios.post<LoginResponse>(`${API_BASE_URL}/auth/activate`, input, {
      withCredentials: true,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      const header: unknown = error.response.headers['retry-after'];
      const parsed = typeof header === 'string' ? Number.parseInt(header, 10) : NaN;
      throw new RateLimitedError(Number.isFinite(parsed) ? parsed : null);
    }
    throw toApiError(error);
  }
}

/** `POST /auth/activate/resend` — always resolves to `void`, even for an
 * unknown identifier (enumeration-safe, see `ActivationService.resend`'s
 * own comment). The one exception is a genuine 429: the caller still needs
 * to know a resend attempt was throttled rather than silently accepted. */
export async function postAuthActivateResend(identifier: string): Promise<void> {
  try {
    await axios.post(`${API_BASE_URL}/auth/activate/resend`, { identifier });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      const header: unknown = error.response.headers['retry-after'];
      const parsed = typeof header === 'string' ? Number.parseInt(header, 10) : NaN;
      throw new RateLimitedError(Number.isFinite(parsed) ? parsed : null);
    }
    throw toApiError(error);
  }
}

export interface ForgotPasswordResponse {
  debug?: { otp?: string; token?: string };
}

/** `POST /auth/forgot-password` — always resolves, even for an unknown
 * identifier (enumeration-safe, see `RecoveryService.forgot`'s own
 * comment). `debug` is only ever populated when the server has D6's
 * `ACCOUNT_ACCESS_ECHO_SECRETS` flag on (never in production) — it exists
 * for e2e/Playwright, not for any real UI to read. */
export async function postAuthForgotPassword(identifier: string): Promise<ForgotPasswordResponse> {
  try {
    const response = await axios.post<ForgotPasswordResponse>(
      `${API_BASE_URL}/auth/forgot-password`,
      { identifier },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      const header: unknown = error.response.headers['retry-after'];
      const parsed = typeof header === 'string' ? Number.parseInt(header, 10) : NaN;
      throw new RateLimitedError(Number.isFinite(parsed) ? parsed : null);
    }
    throw toApiError(error);
  }
}

/** `POST /auth/reset-password` — exactly one of `{ phone, otp }` or
 * `{ token }`, mirroring `ResetPasswordDto`'s own either/or shape. Sets the
 * refresh cookie via `withCredentials` and returns a `LoginResponse`, same
 * as `postAuthActivate` — a successful reset signs the caller straight in. */
export async function postAuthResetPassword(
  input: { new_password: string } & ({ phone: string; otp: string } | { token: string }),
): Promise<LoginResponse> {
  try {
    const response = await axios.post<LoginResponse>(`${API_BASE_URL}/auth/reset-password`, input, {
      withCredentials: true,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 429) {
      const header: unknown = error.response.headers['retry-after'];
      const parsed = typeof header === 'string' ? Number.parseInt(header, 10) : NaN;
      throw new RateLimitedError(Number.isFinite(parsed) ? parsed : null);
    }
    throw toApiError(error);
  }
}

/** Single-flight refresh: the first 401 creates this promise; every
 * concurrent 401 that arrives before it settles awaits the same one instead
 * of issuing its own POST /auth/refresh. The server treats a second refresh
 * request presenting an already-rotated cookie as reuse outside its grace
 * window — see refresh-token.service.ts's TOKEN_REUSE_DETECTED path — so
 * this is not just an optimization, it is what keeps a page that fires
 * several parallel requests on an expired token from tripping that audit
 * path and getting its whole token family revoked.
 *
 * `notifySessionExpired()` lives here, on the single memoized promise, not
 * in the interceptor's own catch block below — that's what makes it fire
 * exactly once even when several concurrent 401s are all awaiting this same
 * promise; each of their own catch blocks would otherwise fire it
 * independently. */
let refreshPromise: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  refreshPromise ??= postAuthRefresh()
    .then((result) => result.access_token)
    .catch((err: unknown) => {
      notifySessionExpired();
      throw err;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

/** Exported for its own unit test — every real call site passes an
 * `AxiosError` (already an `Error`), but the parameter is `unknown`
 * because a rejection handler can genuinely receive anything JS lets you
 * `throw` (a string, a plain object, ...), and this needs to degrade
 * gracefully rather than assume its caller's type annotation held. */
export function toApiError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as Partial<ApiErrorBody> | undefined;
    if (
      body &&
      typeof body.statusCode === 'number' &&
      (typeof body.message === 'string' || Array.isArray(body.message)) &&
      typeof body.requestId === 'string'
    ) {
      return new ApiError(body as ApiErrorBody);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;

    // No isRefreshCall guard: the refresh request never goes through
    // apiClient (see postAuthRefresh's own comment on why), so this
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
        // refreshAccessToken() already cleared auth state and notified the
        // consuming app; surface the original 401, not the refresh's own
        // error, since that is what the caller actually asked for.
        return Promise.reject(toApiError(error));
      }
    }

    return Promise.reject(toApiError(error));
  },
);
