import { UserRole } from '@biddaloy/shared';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getAccessToken,
  getActiveRole,
  getActiveTenant,
  setAccessToken,
  setActiveRole,
  setActiveTenant,
} from '../api/auth-state';
import { NoMembershipsError } from '../api/errors';
import { getPersistedTenant, persistTenant } from '../api/tenant-storage';
import { authHandlers, loginResponseFactory } from '../test/msw/handlers/auth';
import { server } from '../test/msw/server';
import { errorHandler } from '../test/msw/support';

import { changePassword, login, logout, logoutAll } from './auth';

afterEach(() => {
  setAccessToken(null);
  setActiveTenant(null);
  setActiveRole(null);
});

function seedSession(): void {
  setActiveTenant('tenant-1');
  setActiveRole('ADMIN');
  setAccessToken('access-token');
}

describe('login', () => {
  it('clears prior session and cache for a password challenge without installing a session', async () => {
    seedSession();
    const queryClient = new QueryClient();
    queryClient.setQueryData(['private'], 'old-school-data');
    const challenge = {
      password_change_required: true,
      reset_token: 'test-only-challenge',
      expires_at: '2030-01-01T00:00:00Z',
    };
    server.use(http.post('/api/v1/auth/login', () => HttpResponse.json(challenge)));
    expect(await login(queryClient, { email: 'test@example.com', password: 'temporary' })).toEqual(
      challenge,
    );
    expect(getAccessToken()).toBeNull();
    expect(getActiveTenant()).toBeNull();
    expect(getActiveRole()).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
  it('stores the access token and activates the single membership returned', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(
          loginResponseFactory({
            access_token: 'fresh-token',
            memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN, name: 'Greenview School' }],
          }),
        ),
      ),
    );
    const queryClient = new QueryClient();

    await login(queryClient, { email: 'rahim@greenview.edu.bd', password: 'hunter2fake' });

    expect(getAccessToken()).toBe('fresh-token');
    expect(getActiveTenant()).toBe('tenant-1');
    expect(getActiveRole()).toBe(UserRole.ADMIN);
  });

  it('[8.9.5] leaves the active tenant unset for 2+ memberships — no silent pick — but still sets the token', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(
          loginResponseFactory({
            access_token: 'fresh-token',
            memberships: [
              { tenantId: 'tenant-first', role: UserRole.ADMIN, name: 'Greenview School' },
              { tenantId: 'tenant-second', role: UserRole.TEACHER, name: 'Rose Valley School' },
            ],
          }),
        ),
      ),
    );
    const queryClient = new QueryClient();

    const result = await login(queryClient, {
      email: 'rahim@greenview.edu.bd',
      password: 'hunter2fake',
    });

    expect(getAccessToken()).toBe('fresh-token');
    expect(getActiveTenant()).toBeNull();
    expect(getActiveRole()).toBeNull();
    expect('memberships' in result && result.memberships).toHaveLength(2);
  });

  it('[8.9.5] clears a prior session (tenant, role, persisted tenant, cache) before a multi-membership login, keeping only the new token', async () => {
    setActiveTenant('tenant-old');
    setActiveRole(UserRole.ADMIN);
    setAccessToken('old-token');
    persistTenant('tenant-old');
    const queryClient = new QueryClient();
    queryClient.setQueryData(['stale-from-previous-session'], { ok: true });
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(
          loginResponseFactory({
            access_token: 'fresh-token',
            memberships: [
              { tenantId: 'tenant-first', role: UserRole.ADMIN, name: 'Greenview School' },
              { tenantId: 'tenant-second', role: UserRole.TEACHER, name: 'Rose Valley School' },
            ],
          }),
        ),
      ),
    );

    await login(queryClient, { email: 'rahim@greenview.edu.bd', password: 'hunter2fake' });

    expect(getAccessToken()).toBe('fresh-token');
    expect(getActiveTenant()).toBeNull();
    expect(getActiveRole()).toBeNull();
    expect(getPersistedTenant()).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('clears any stale cached queries from a previous session, same as switchActiveTenant', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(
          loginResponseFactory({
            memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN, name: 'Greenview School' }],
          }),
        ),
      ),
    );
    const queryClient = new QueryClient();
    queryClient.setQueryData(['stale-from-previous-session'], { ok: true });

    await login(queryClient, { email: 'rahim@greenview.edu.bd', password: 'hunter2fake' });

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('revokes the session and throws NoMembershipsError, leaving no local auth state, when the account has no active school membership', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(loginResponseFactory({ memberships: [] })),
      ),
    );
    let logoutRequests = 0;
    server.use(
      http.post('/api/v1/auth/logout', () => {
        logoutRequests += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const queryClient = new QueryClient();

    await expect(
      login(queryClient, { email: 'rahim@greenview.edu.bd', password: 'hunter2fake' }),
    ).rejects.toBeInstanceOf(NoMembershipsError);

    // The login itself succeeded server-side (a real token was issued and a
    // refresh cookie set), so a memberless account must be actively revoked
    // — not just left alone — or a page reload could silently restore an
    // authenticated-but-unusable session via that cookie.
    expect(logoutRequests).toBe(1);
    expect(getAccessToken()).toBeNull();
    expect(getActiveTenant()).toBeNull();
  });

  it('still throws NoMembershipsError even when the revoke call itself fails', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(loginResponseFactory({ memberships: [] })),
      ),
      errorHandler('post', '/api/v1/auth/logout', 500),
    );
    const queryClient = new QueryClient();

    await expect(
      login(queryClient, { email: 'rahim@greenview.edu.bd', password: 'hunter2fake' }),
    ).rejects.toBeInstanceOf(NoMembershipsError);
    expect(getAccessToken()).toBeNull();
  });

  it('propagates a login failure without touching any local state', async () => {
    server.use(errorHandler('post', '/api/v1/auth/login', 401));
    const queryClient = new QueryClient();

    await expect(
      login(queryClient, { email: 'rahim@greenview.edu.bd', password: 'wrong' }),
    ).rejects.toThrow();
    expect(getAccessToken()).toBeNull();
  });
});

describe('logout', () => {
  it('clears the token, tenant, role, and query cache on success', async () => {
    seedSession();
    const queryClient = new QueryClient();
    queryClient.setQueryData(['probe'], { ok: true });

    await logout(queryClient);

    expect(getAccessToken()).toBeNull();
    expect(getActiveTenant()).toBeNull();
    expect(getActiveRole()).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('still clears local state even when the server call fails', async () => {
    seedSession();
    server.use(errorHandler('post', '/api/v1/auth/logout', 500));
    const queryClient = new QueryClient();
    queryClient.setQueryData(['probe'], { ok: true });

    await expect(logout(queryClient)).rejects.toThrow();

    expect(getAccessToken()).toBeNull();
    expect(getActiveTenant()).toBeNull();
    expect(getActiveRole()).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('reaches the server even with an access token but no active tenant selected yet', async () => {
    // Mirrors a session restored by a cold-boot refresh before the user
    // has picked a tenant — apiClient would reject this before dispatch
    // (NoActiveTenantError), so logout must not go through it.
    setAccessToken('access-token');
    let logoutRequests = 0;
    let receivedAuthHeader: string | null = null;
    server.use(
      http.post('/api/v1/auth/logout', ({ request }) => {
        logoutRequests += 1;
        receivedAuthHeader = request.headers.get('Authorization');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const queryClient = new QueryClient();

    await logout(queryClient);

    expect(logoutRequests).toBe(1);
    expect(receivedAuthHeader).toBe('Bearer access-token');
    expect(getAccessToken()).toBeNull();
  });
});

describe('logoutAll', () => {
  it('clears the token, tenant, role, and query cache on success', async () => {
    seedSession();
    const queryClient = new QueryClient();
    queryClient.setQueryData(['probe'], { ok: true });

    await logoutAll(queryClient);

    expect(getAccessToken()).toBeNull();
    expect(getActiveTenant()).toBeNull();
    expect(getActiveRole()).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('still clears local state even when the server call fails', async () => {
    seedSession();
    server.use(errorHandler('post', '/api/v1/auth/logout-all', 500));
    const queryClient = new QueryClient();
    queryClient.setQueryData(['probe'], { ok: true });

    await expect(logoutAll(queryClient)).rejects.toThrow();

    expect(getAccessToken()).toBeNull();
    expect(getActiveTenant()).toBeNull();
    expect(getActiveRole()).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe('changePassword', () => {
  it('[8.14.4] stores the fresh access token and reschedules refresh, WITHOUT clearing auth state or the query cache', async () => {
    // The load-bearing case plan correction 3 exists for: unlike
    // `login`/`endSession`, this device's own session must keep working —
    // only *other* devices' refresh tokens are revoked server-side.
    seedSession();
    const queryClient = new QueryClient();
    queryClient.setQueryData(['probe'], { ok: true });
    server.use(
      http.post('/api/v1/auth/change-password', () =>
        HttpResponse.json(loginResponseFactory({ access_token: 'post-change-password-token' })),
      ),
    );

    const result = await changePassword({
      current_password: 'old-pass',
      new_password: 'new-pass',
    });

    expect(result.access_token).toBe('post-change-password-token');
    expect(getAccessToken()).toBe('post-change-password-token');
    // Still this same session's tenant/role — not cleared.
    expect(getActiveTenant()).toBe('tenant-1');
    expect(getActiveRole()).toBe('ADMIN');
    // The query cache is untouched — a password change invalidates no
    // cached data of its own.
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it('surfaces the 403 wrong-current-password case as an ApiError, without touching local state', async () => {
    seedSession();
    server.use(authHandlers.changePassword);

    await expect(
      changePassword({
        current_password: authHandlers.CHANGE_PASSWORD_WRONG_CURRENT,
        new_password: 'new-pass',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(getAccessToken()).toBe('access-token');
  });
});
