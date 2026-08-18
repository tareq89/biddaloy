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
import { loginResponseFactory } from '../test/msw/handlers/auth';
import { server } from '../test/msw/server';
import { errorHandler } from '../test/msw/support';

import { login, logout, logoutAll } from './auth';

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
  it('stores the access token and activates the single membership returned', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(
          loginResponseFactory({
            access_token: 'fresh-token',
            memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN }],
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

  it('picks the first membership when there is more than one, until [8.9.5] adds a real picker', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(
          loginResponseFactory({
            memberships: [
              { tenantId: 'tenant-first', role: UserRole.ADMIN },
              { tenantId: 'tenant-second', role: UserRole.TEACHER },
            ],
          }),
        ),
      ),
    );
    const queryClient = new QueryClient();

    await login(queryClient, { email: 'rahim@greenview.edu.bd', password: 'hunter2fake' });

    expect(getActiveTenant()).toBe('tenant-first');
    expect(getActiveRole()).toBe(UserRole.ADMIN);
  });

  it('clears any stale cached queries from a previous session, same as switchActiveTenant', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(
          loginResponseFactory({
            memberships: [{ tenantId: 'tenant-1', role: UserRole.ADMIN }],
          }),
        ),
      ),
    );
    const queryClient = new QueryClient();
    queryClient.setQueryData(['stale-from-previous-session'], { ok: true });

    await login(queryClient, { email: 'rahim@greenview.edu.bd', password: 'hunter2fake' });

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('throws NoMembershipsError when the account has no active school membership', async () => {
    server.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(loginResponseFactory({ memberships: [] })),
      ),
    );
    const queryClient = new QueryClient();

    await expect(
      login(queryClient, { email: 'rahim@greenview.edu.bd', password: 'hunter2fake' }),
    ).rejects.toBeInstanceOf(NoMembershipsError);
    // The token itself is real — the login succeeded — even though there's
    // no tenant to select yet.
    expect(getAccessToken()).not.toBeNull();
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
