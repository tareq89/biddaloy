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
import { server } from '../test/msw/server';
import { errorHandler } from '../test/msw/support';

import { logout, logoutAll } from './auth';

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
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
