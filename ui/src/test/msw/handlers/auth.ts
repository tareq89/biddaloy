import { UserRole, type LoginResponse } from '@biddaloy/shared';
import { http, HttpResponse } from 'msw';

import { apiErrorBody } from '../support';

/**
 * `POST /api/v1/auth/login` returns `LoginResponse` (`@biddaloy/shared`) at
 * runtime — schema.d.ts's `AuthController_login_v1` 200 body is
 * `Record<string, never>` because the controller never declared an
 * `@ApiResponse` type, not because the shape differs. Same for `refresh`.
 *
 * "Token expiry" isn't modeled as a separate handler here: `client.ts`'s
 * response interceptor already treats an access-token-expired 401 the same
 * as any other protected-endpoint 401 — it single-flights a call to
 * `refresh` and retries once. So the scenario is exercised by pairing any
 * protected endpoint's `errorHandler(..., 401, ...)` with either `refresh`
 * (expiry recovered) or `refreshFailure` (session actually ends) below,
 * rather than a third bespoke handler.
 */
export function loginResponseFactory(overrides: Partial<LoginResponse> = {}): LoginResponse {
  return {
    access_token: 'mock-access-token',
    memberships: [{ tenantId: 'mock-tenant-id', role: UserRole.ADMIN, name: 'Mock School' }],
    ...overrides,
  };
}

const login = http.post('/api/v1/auth/login', () => HttpResponse.json(loginResponseFactory()));

const loginInvalidCredentials = http.post('/api/v1/auth/login', () =>
  HttpResponse.json(apiErrorBody(401, 'Invalid credentials', '/api/v1/auth/login'), {
    status: 401,
  }),
);

/** Mirrors the real `@nestjs/throttler` guard: 429 with a `Retry-After`
 * header carrying the wait, in seconds — see `postAuthLogin`'s own comment
 * in `ui/src/api/client.ts` for why that header, not the body, is what a
 * caller actually reads. */
const loginRateLimited = http.post('/api/v1/auth/login', () =>
  HttpResponse.json(
    apiErrorBody(429, 'ThrottlerException: Too Many Requests', '/api/v1/auth/login'),
    { status: 429, headers: { 'Retry-After': '45' } },
  ),
);

const refresh = http.post('/api/v1/auth/refresh', () =>
  HttpResponse.json(loginResponseFactory({ access_token: 'mock-refreshed-access-token' })),
);

const refreshFailure = http.post('/api/v1/auth/refresh', () =>
  HttpResponse.json(
    apiErrorBody(
      401,
      'Missing, expired, invalid, or already-used refresh token',
      '/api/v1/auth/refresh',
    ),
    { status: 401 },
  ),
);

/** `POST /auth/change-password` — [8.14.4]'s Account page password card
 * (`AuthController.changePassword`). Keyed off a sentinel current-password
 * value so both the happy path and the 403 "wrong current password" case
 * are reachable from tests/stories without a second handler shape. */
const CHANGE_PASSWORD_WRONG_CURRENT = 'wrong-current-password';

const changePassword = http.post('/api/v1/auth/change-password', async ({ request }) => {
  const body = (await request.json()) as { current_password?: string };
  if (body.current_password === CHANGE_PASSWORD_WRONG_CURRENT) {
    return HttpResponse.json(
      apiErrorBody(403, 'current_password is incorrect', '/api/v1/auth/change-password'),
      { status: 403 },
    );
  }
  return HttpResponse.json(
    loginResponseFactory({ access_token: 'mock-post-change-password-access-token' }),
  );
});

const logout = http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 }));

const logoutAll = http.post(
  '/api/v1/auth/logout-all',
  () => new HttpResponse(null, { status: 204 }),
);

export const authHandlers = {
  login,
  loginInvalidCredentials,
  loginRateLimited,
  refresh,
  refreshFailure,
  changePassword,
  CHANGE_PASSWORD_WRONG_CURRENT,
  logout,
  logoutAll,
};

export const authDefaultHandlers = [login, refresh, changePassword, logout, logoutAll];
