import { UserRole, type LoginResponse } from '@beton-boi/shared';
import { http, HttpResponse } from 'msw';

import { apiErrorBody } from '../support';

/**
 * `POST /api/v1/auth/login` returns `LoginResponse` (`@beton-boi/shared`) at
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
    memberships: [{ tenantId: 'mock-tenant-id', role: UserRole.ADMIN }],
    ...overrides,
  };
}

const login = http.post('/api/v1/auth/login', () => HttpResponse.json(loginResponseFactory()));

const loginInvalidCredentials = http.post('/api/v1/auth/login', () =>
  HttpResponse.json(apiErrorBody(401, 'Invalid credentials', '/api/v1/auth/login'), {
    status: 401,
  }),
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

const logout = http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 }));

const logoutAll = http.post(
  '/api/v1/auth/logout-all',
  () => new HttpResponse(null, { status: 204 }),
);

export const authHandlers = {
  login,
  loginInvalidCredentials,
  refresh,
  refreshFailure,
  logout,
  logoutAll,
};

export const authDefaultHandlers = [login, refresh, logout, logoutAll];
