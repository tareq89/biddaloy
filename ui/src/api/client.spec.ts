import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAuthState,
  getAccessToken,
  registerSessionExpiredHandler,
  setAccessToken,
  setActiveRole,
  setActiveTenant,
} from './auth-state';
import { apiClient, toApiError } from './client';
import { ApiError, NoActiveTenantError } from './errors';

// Two separate mock surfaces: `apiClient` is its own axios.create() instance;
// the refresh call deliberately uses the raw `axios` default export (see
// client.ts's comment on why), so both need mocking independently.
let apiMock: MockAdapter;
let globalMock: MockAdapter;

beforeEach(() => {
  apiMock = new MockAdapter(apiClient);
  globalMock = new MockAdapter(axios);
  clearAuthState();
  registerSessionExpiredHandler(null);
});

afterEach(() => {
  apiMock.restore();
  globalMock.restore();
});

describe('request interceptor: tenant/role/token injection', () => {
  it('throws NoActiveTenantError before hitting the network when no tenant is active', async () => {
    apiMock.onGet('/students').reply(200, { ok: true });

    await expect(apiClient.get('/students')).rejects.toBeInstanceOf(NoActiveTenantError);
    expect(apiMock.history.get.length).toBe(0);
  });

  it('attaches X-Tenant-ID when a tenant is active', async () => {
    setActiveTenant('tenant-1');
    apiMock
      .onGet('/students')
      .reply((config) => [200, { tenant: config.headers?.['X-Tenant-ID'] }]);

    const res = await apiClient.get('/students');
    expect(res.data.tenant).toBe('tenant-1');
  });

  it('attaches X-Role only when a role is explicitly set', async () => {
    setActiveTenant('tenant-1');
    apiMock
      .onGet('/students')
      .reply((config) => [200, { role: config.headers?.['X-Role'] ?? null }]);

    const withoutRole = await apiClient.get('/students');
    expect(withoutRole.data.role).toBeNull();

    setActiveRole('teacher');
    const withRole = await apiClient.get('/students');
    expect(withRole.data.role).toBe('teacher');
  });

  it('attaches Authorization when an access token is set', async () => {
    setActiveTenant('tenant-1');
    setAccessToken('token-abc');
    apiMock.onGet('/students').reply((config) => [200, { auth: config.headers?.Authorization }]);

    const res = await apiClient.get('/students');
    expect(res.data.auth).toBe('Bearer token-abc');
  });
});

describe('401 handling: refresh and replay', () => {
  it('triggers exactly one refresh and replays the original request', async () => {
    setActiveTenant('tenant-1');
    setAccessToken('expired-token');

    let studentsCallCount = 0;
    apiMock.onGet('/students').reply(() => {
      studentsCallCount += 1;
      const auth = studentsCallCount === 1 ? 'expired-token' : 'fresh-token';
      return studentsCallCount === 1
        ? [
            401,
            {
              statusCode: 401,
              message: 'jwt expired',
              timestamp: 't',
              path: '/students',
              requestId: 'r1',
            },
          ]
        : [200, { data: 'ok', authUsed: auth }];
    });
    globalMock.onPost('/api/v1/auth/refresh').reply(200, { access_token: 'fresh-token' });

    const res = await apiClient.get('/students');

    expect(res.data.data).toBe('ok');
    expect(globalMock.history.post.length).toBe(1);
    expect(studentsCallCount).toBe(2);
    expect(getAccessToken()).toBe('fresh-token');
  });

  it('shares a single refresh across concurrent 401s (single-flight)', async () => {
    setActiveTenant('tenant-1');
    setAccessToken('expired-token');

    apiMock.onGet(/\/resource-\d/).reply((config) => {
      const auth = config.headers?.Authorization;
      if (auth === 'Bearer fresh-token') {
        return [200, { url: config.url }];
      }
      return [
        401,
        {
          statusCode: 401,
          message: 'jwt expired',
          timestamp: 't',
          path: config.url,
          requestId: 'r',
        },
      ];
    });

    let refreshCallCount = 0;
    globalMock.onPost('/api/v1/auth/refresh').reply(() => {
      refreshCallCount += 1;
      // Simulate real latency so all three 401s land before refresh settles.
      return new Promise((resolve) => {
        setTimeout(() => resolve([200, { access_token: 'fresh-token' }]), 20);
      });
    });

    const [a, b, c] = await Promise.all([
      apiClient.get('/resource-1'),
      apiClient.get('/resource-2'),
      apiClient.get('/resource-3'),
    ]);

    expect(refreshCallCount).toBe(1);
    expect([a.data.url, b.data.url, c.data.url].sort()).toEqual([
      '/resource-1',
      '/resource-2',
      '/resource-3',
    ]);
  });

  it('does not attempt refresh a second time on a repeat 401 after replay (no infinite loop)', async () => {
    setActiveTenant('tenant-1');
    setAccessToken('expired-token');

    apiMock.onGet('/students').reply(401, {
      statusCode: 401,
      message: 'jwt expired',
      timestamp: 't',
      path: '/students',
      requestId: 'r',
    });
    let refreshCallCount = 0;
    globalMock.onPost('/api/v1/auth/refresh').reply(() => {
      refreshCallCount += 1;
      return [200, { access_token: 'still-rejected-token' }];
    });

    await expect(apiClient.get('/students')).rejects.toBeInstanceOf(ApiError);
    expect(refreshCallCount).toBe(1);
    expect(apiMock.history.get.length).toBe(2); // original + exactly one replay
  });

  it('give-up path: refresh failure clears auth state and notifies exactly once, no redirect loop', async () => {
    setActiveTenant('tenant-1');
    setAccessToken('expired-token');

    const onSessionExpired = vi.fn();
    registerSessionExpiredHandler(onSessionExpired);

    apiMock.onGet(/\/resource-\d/).reply(401, {
      statusCode: 401,
      message: 'jwt expired',
      timestamp: 't',
      path: '/x',
      requestId: 'r',
    });
    globalMock.onPost('/api/v1/auth/refresh').reply(401, {
      statusCode: 401,
      message: 'Invalid refresh token',
      timestamp: 't',
      path: '/api/v1/auth/refresh',
      requestId: 'r2',
    });

    const results = await Promise.allSettled([
      apiClient.get('/resource-1'),
      apiClient.get('/resource-2'),
    ]);

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it('attempts refresh exactly once when the refresh call itself keeps failing (no recursive refresh)', async () => {
    // The refresh request goes through raw axios, never apiClient (see
    // performRefresh's comment on why) — so apiClient's response
    // interceptor never actually sees a 401 *from* /auth/refresh. What
    // stops a loop here is that a failed refresh rejects performRefresh(),
    // which the caller's catch surfaces directly rather than looping back
    // into refreshAccessToken() again.
    setActiveTenant('tenant-1');
    setAccessToken('expired-token');

    globalMock.onPost('/api/v1/auth/refresh').reply(401, {
      statusCode: 401,
      message: 'Invalid refresh token',
      timestamp: 't',
      path: '/api/v1/auth/refresh',
      requestId: 'r',
    });
    apiMock.onGet('/students').reply(401, {
      statusCode: 401,
      message: 'jwt expired',
      timestamp: 't',
      path: '/students',
      requestId: 'r',
    });

    await expect(apiClient.get('/students')).rejects.toBeInstanceOf(ApiError);
    expect(globalMock.history.post.length).toBe(1);
  });
});

describe('ApiError mapping', () => {
  it('wraps a server error body in a typed ApiError', async () => {
    setActiveTenant('tenant-1');
    apiMock.onGet('/students').reply(403, {
      statusCode: 403,
      message: 'User is not a member of tenant tenant-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      path: '/students',
      requestId: 'req-123',
    });

    try {
      await apiClient.get('/students');
      expect.unreachable('expected apiClient.get to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.statusCode).toBe(403);
      expect(apiErr.message).toBe('User is not a member of tenant tenant-1');
      expect(apiErr.requestId).toBe('req-123');
    }
  });
});

describe('toApiError', () => {
  it('passes an AxiosError through unchanged when its body is not a well-formed ApiErrorBody', () => {
    const axiosError = Object.assign(new Error('Network Error'), {
      isAxiosError: true,
      response: { data: { unexpected: 'shape' } },
    });

    expect(toApiError(axiosError)).toBe(axiosError);
  });

  it('wraps a non-Error thrown value (e.g. a plain string) in a real Error', () => {
    const wrapped = toApiError('boom');

    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe('boom');
  });
});
