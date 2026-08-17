import { QueryClient } from '@tanstack/react-query';
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
