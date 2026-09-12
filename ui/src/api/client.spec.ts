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
import {
  apiClient,
  postAuthActivate,
  postAuthActivateResend,
  postAuthActivateVerify,
  postAuthForgotPassword,
  postAuthLogin,
  postAuthRefresh,
  postAuthResetPassword,
  postAuthVerifyEmail,
  toApiError,
} from './client';
import { ApiError, NoActiveTenantError, RateLimitedError } from './errors';

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

  it('[14.13.3, hardened per item 7] a `_tenantOverride` config field overrides the ambient active tenant', async () => {
    setActiveTenant('tenant-1');
    apiMock
      .onGet('/backup/jobs/job-1')
      .reply((config) => [200, { tenant: config.headers?.['X-Tenant-ID'] }]);

    const res = await apiClient.get('/backup/jobs/job-1', {
      _tenantOverride: 'tenant-2',
    });
    expect(res.data.tenant).toBe('tenant-2');
  });

  it('[14.13.3] still requires a tenant when no ambient tenant is active and none is pre-set', async () => {
    apiMock.onGet('/students').reply(200, { ok: true });

    await expect(apiClient.get('/students')).rejects.toBeInstanceOf(NoActiveTenantError);
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

  it('replays a write against the tenant it was prepared for, even if the active tenant changed mid-flight', async () => {
    // A POST built for school A must never land on school B. The replay
    // re-enters the request interceptor, which used to re-read the ambient
    // active tenant — so switching schools while a write was in flight (and
    // it 401'd) silently redirected the write. The server can't catch this
    // when the user legitimately has access to both.
    setActiveTenant('tenant-A');
    setAccessToken('expired-token');

    const seenTenants: (string | undefined)[] = [];
    let callCount = 0;
    apiMock.onPost('/students').reply((config) => {
      callCount += 1;
      seenTenants.push(config.headers?.['X-Tenant-ID'] as string | undefined);
      if (callCount === 1) {
        // The user switches schools while this request is in flight.
        setActiveTenant('tenant-B');
        return [
          401,
          {
            statusCode: 401,
            message: 'jwt expired',
            timestamp: 't',
            path: '/students',
            requestId: 'r1',
          },
        ];
      }
      return [200, { ok: true }];
    });
    globalMock.onPost('/api/v1/auth/refresh').reply(200, { access_token: 'fresh-token' });

    await apiClient.post('/students', { full_name: 'New Student' });

    expect(callCount).toBe(2);
    expect(seenTenants).toEqual(['tenant-A', 'tenant-A']);
  });

  it('still honours an explicit _tenantOverride across a replay', async () => {
    setActiveTenant('tenant-A');
    setAccessToken('expired-token');

    const seenTenants: (string | undefined)[] = [];
    let callCount = 0;
    apiMock.onGet('/backup/jobs').reply((config) => {
      callCount += 1;
      seenTenants.push(config.headers?.['X-Tenant-ID'] as string | undefined);
      return callCount === 1
        ? [
            401,
            {
              statusCode: 401,
              message: 'jwt expired',
              timestamp: 't',
              path: '/backup/jobs',
              requestId: 'r1',
            },
          ]
        : [200, { data: [] }];
    });
    globalMock.onPost('/api/v1/auth/refresh').reply(200, { access_token: 'fresh-token' });

    await apiClient.get('/backup/jobs', { _tenantOverride: 'tenant-override' });

    expect(seenTenants).toEqual(['tenant-override', 'tenant-override']);
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

  // [item 7, money-tier review] The OLD implementation read
  // `config.headers.get('X-Tenant-ID')` back as if it were a caller
  // override. Since the request interceptor itself had already stamped
  // that header onto the config on the FIRST attempt, re-dispatching the
  // same config object on a 401 retry made the interceptor read back its
  // own earlier stamp and treat it as an explicit override.
  //
  // Fixing that mechanism is right; the behaviour change that first came
  // with it was not. This test originally asserted that the retry picks up
  // the NEW active tenant — but a request is prepared for ONE tenant, and
  // a transparent token-refresh retry must not silently redirect it
  // somewhere else (see the write-request test above: a POST built for
  // school A landing on school B is a real data-integrity bug the server
  // cannot catch when the user can access both). `_resolvedTenantId` gets
  // both properties: no self-read of the header, and a stable tenant
  // across the replay.
  it('[item 7] a plain ambient-tenant request replays against the tenant it was first sent for, even if the active tenant changed', async () => {
    setActiveTenant('tenant-1');
    setAccessToken('expired-token');

    let call = 0;
    apiMock.onGet('/students').reply((config) => {
      call += 1;
      if (call === 1) {
        return [
          401,
          {
            statusCode: 401,
            message: 'jwt expired',
            timestamp: 't',
            path: '/students',
            requestId: 'r1',
          },
        ];
      }
      return [200, { tenant: config.headers?.['X-Tenant-ID'] }];
    });
    globalMock.onPost('/api/v1/auth/refresh').reply(() => {
      // The user switches active school while the refresh itself is
      // in flight — simulating a real race, not just a same-tick swap.
      setActiveTenant('tenant-2');
      return [200, { access_token: 'fresh-token' }];
    });

    const res = await apiClient.get('/students');

    expect(res.data.tenant).toBe('tenant-1');
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

  it('wraps a validation error body whose message is an array (ValidationPipe shape)', async () => {
    setActiveTenant('tenant-1');
    apiMock.onPost('/students').reply(400, {
      statusCode: 400,
      message: ['full_name should not be empty', 'email must be an email'],
      timestamp: '2026-01-01T00:00:00.000Z',
      path: '/students',
      requestId: 'req-456',
    });

    try {
      await apiClient.post('/students', {});
      expect.unreachable('expected apiClient.post to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.messages).toEqual(['full_name should not be empty', 'email must be an email']);
      expect(apiErr.message).toBe('full_name should not be empty email must be an email');
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

describe('postAuthRefresh: session-generation guard', () => {
  it('does not restore an access token if the session was reset while the refresh was in flight', async () => {
    let resolveRefresh: ((value: [number, { access_token: string }]) => void) | undefined;
    globalMock.onPost('/api/v1/auth/refresh').reply(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    const refreshPromise = postAuthRefresh();
    // Simulates a logout (or a sibling refresh's failure) completing
    // before this already-in-flight refresh's network response arrives.
    clearAuthState();
    resolveRefresh?.([200, { access_token: 'stale-token' }]);

    await expect(refreshPromise).resolves.toMatchObject({ access_token: 'stale-token' });
    expect(getAccessToken()).toBeNull();
  });

  it('still restores the token when nothing reset the session while it was in flight', async () => {
    globalMock.onPost('/api/v1/auth/refresh').reply(200, { access_token: 'fresh-token' });

    await expect(postAuthRefresh()).resolves.toMatchObject({ access_token: 'fresh-token' });
    expect(getAccessToken()).toBe('fresh-token');
  });
});

describe('postAuthLogin', () => {
  it('sends an email credential as { email, password }, not { phone }', async () => {
    globalMock.onPost('/api/v1/auth/login').reply((config) => {
      const body: unknown = JSON.parse(config.data as string);
      return [200, { access_token: 'tok', memberships: [], receivedBody: body }];
    });

    const result = (await postAuthLogin({
      email: 'rahim@greenview.edu.bd',
      password: 'hunter2fake',
    })) as unknown as { receivedBody: unknown };

    expect(result.receivedBody).toEqual({
      email: 'rahim@greenview.edu.bd',
      password: 'hunter2fake',
    });
  });

  it('sends a phone credential as { phone, password }, not { email }', async () => {
    globalMock.onPost('/api/v1/auth/login').reply((config) => {
      const body: unknown = JSON.parse(config.data as string);
      return [200, { access_token: 'tok', memberships: [], receivedBody: body }];
    });

    const result = (await postAuthLogin({
      phone: '01712345678',
      password: 'hunter2fake',
    })) as unknown as { receivedBody: unknown };

    expect(result.receivedBody).toEqual({ phone: '01712345678', password: 'hunter2fake' });
  });

  it('resolves with the real LoginResponse on success', async () => {
    globalMock.onPost('/api/v1/auth/login').reply(200, {
      access_token: 'tok',
      memberships: [{ tenantId: 'tenant-1', role: 'ADMIN' }],
    });

    await expect(
      postAuthLogin({ email: 'rahim@greenview.edu.bd', password: 'hunter2fake' }),
    ).resolves.toEqual({
      access_token: 'tok',
      memberships: [{ tenantId: 'tenant-1', role: 'ADMIN' }],
    });
  });

  it('wraps a 401 in ApiError, same as every other endpoint', async () => {
    globalMock.onPost('/api/v1/auth/login').reply(401, {
      statusCode: 401,
      message: 'Invalid credentials',
      timestamp: 't',
      path: '/api/v1/auth/login',
      requestId: 'r',
    });

    await expect(
      postAuthLogin({ email: 'rahim@greenview.edu.bd', password: 'wrong' }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('turns a 429 into RateLimitedError with the Retry-After header parsed', async () => {
    globalMock.onPost('/api/v1/auth/login').reply(
      429,
      { statusCode: 429, message: 'ThrottlerException: Too Many Requests' },
      {
        'retry-after': '45',
      },
    );

    const error = await postAuthLogin({
      email: 'rahim@greenview.edu.bd',
      password: 'hunter2fake',
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(45);
  });

  it('turns a 429 with no Retry-After header into RateLimitedError with a null wait', async () => {
    globalMock.onPost('/api/v1/auth/login').reply(429, {
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });

    const error = await postAuthLogin({
      email: 'rahim@greenview.edu.bd',
      password: 'hunter2fake',
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBeNull();
  });
});

describe('postAuthActivateVerify', () => {
  it('resolves with the verify response on success', async () => {
    globalMock
      .onPost('/api/v1/auth/activate/verify')
      .reply(200, { status: 'valid', full_name: 'Rahim', school_name: 'Greenview' });

    await expect(postAuthActivateVerify('tok')).resolves.toEqual({
      status: 'valid',
      full_name: 'Rahim',
      school_name: 'Greenview',
    });
  });

  it('turns a 429 into RateLimitedError with the Retry-After header parsed', async () => {
    globalMock
      .onPost('/api/v1/auth/activate/verify')
      .reply(429, { statusCode: 429, message: 'Too Many Requests' }, { 'retry-after': '30' });

    const error = await postAuthActivateVerify('tok').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(30);
  });

  it('turns a 429 with no Retry-After header into RateLimitedError with a null wait', async () => {
    globalMock
      .onPost('/api/v1/auth/activate/verify')
      .reply(429, { statusCode: 429, message: 'Too Many Requests' });

    const error = await postAuthActivateVerify('tok').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBeNull();
  });

  it('wraps a non-429 failure in ApiError', async () => {
    globalMock.onPost('/api/v1/auth/activate/verify').reply(500, {
      statusCode: 500,
      message: 'Internal error',
      timestamp: 't',
      path: '/api/v1/auth/activate/verify',
      requestId: 'r',
    });

    await expect(postAuthActivateVerify('tok')).rejects.toBeInstanceOf(ApiError);
  });
});

/**
 * [12.7] Same bare-`axios`, never-throws-for-a-bad-token contract as
 * `postAuthActivateVerify` above — the link is clicked from an inbox, on a
 * device that may have no session at all.
 */
describe('postAuthVerifyEmail', () => {
  it('resolves with the status on success', async () => {
    globalMock.onPost('/api/v1/auth/verify-email').reply(200, { status: 'valid' });

    await expect(postAuthVerifyEmail('tok')).resolves.toEqual({ status: 'valid' });
  });

  // An expired/consumed/revoked/unknown token is a 200 with a different
  // `status`, NOT a rejection — the page renders a card per status.
  it('resolves (does not reject) for an expired token', async () => {
    globalMock.onPost('/api/v1/auth/verify-email').reply(200, { status: 'expired' });

    await expect(postAuthVerifyEmail('tok')).resolves.toEqual({ status: 'expired' });
  });

  it('turns a 429 into RateLimitedError with the Retry-After header parsed', async () => {
    globalMock
      .onPost('/api/v1/auth/verify-email')
      .reply(429, { statusCode: 429, message: 'Too Many Requests' }, { 'retry-after': '20' });

    const error = await postAuthVerifyEmail('tok').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(20);
  });

  it('turns a 429 with no Retry-After header into RateLimitedError with a null wait', async () => {
    globalMock
      .onPost('/api/v1/auth/verify-email')
      .reply(429, { statusCode: 429, message: 'Too Many Requests' });

    const error = await postAuthVerifyEmail('tok').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBeNull();
  });

  // A non-numeric Retry-After must not surface as `NaN` seconds — the
  // `Number.isFinite` guard collapses it to "unknown wait", same as a
  // missing header.
  it('treats an unparseable Retry-After as a null wait', async () => {
    globalMock
      .onPost('/api/v1/auth/verify-email')
      .reply(429, { statusCode: 429, message: 'Too Many Requests' }, { 'retry-after': 'soon' });

    const error = await postAuthVerifyEmail('tok').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBeNull();
  });

  it('wraps a non-429 failure in ApiError', async () => {
    globalMock.onPost('/api/v1/auth/verify-email').reply(500, {
      statusCode: 500,
      message: 'Internal error',
      timestamp: 't',
      path: '/api/v1/auth/verify-email',
      requestId: 'r',
    });

    await expect(postAuthVerifyEmail('tok')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('postAuthActivate', () => {
  it('resolves with the real LoginResponse on success', async () => {
    globalMock.onPost('/api/v1/auth/activate').reply(200, {
      access_token: 'tok',
      memberships: [{ tenantId: 'tenant-1', role: 'ADMIN' }],
    });

    await expect(postAuthActivate({ token: 'tok', password: 'hunter2fake' })).resolves.toEqual({
      access_token: 'tok',
      memberships: [{ tenantId: 'tenant-1', role: 'ADMIN' }],
    });
  });

  it('turns a 429 into RateLimitedError with the Retry-After header parsed', async () => {
    globalMock
      .onPost('/api/v1/auth/activate')
      .reply(429, { statusCode: 429, message: 'Too Many Requests' }, { 'retry-after': '12' });

    const error = await postAuthActivate({ token: 'tok', password: 'hunter2fake' }).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(12);
  });

  it('turns a 429 with no Retry-After header into RateLimitedError with a null wait', async () => {
    globalMock.onPost('/api/v1/auth/activate').reply(429, {
      statusCode: 429,
      message: 'Too Many Requests',
    });

    const error = await postAuthActivate({ token: 'tok', password: 'hunter2fake' }).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBeNull();
  });

  it('wraps a non-429 failure (e.g. expired token) in ApiError', async () => {
    globalMock.onPost('/api/v1/auth/activate').reply(400, {
      statusCode: 400,
      message: 'expired',
      timestamp: 't',
      path: '/api/v1/auth/activate',
      requestId: 'r',
    });

    await expect(
      postAuthActivate({ token: 'tok', password: 'hunter2fake' }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('postAuthActivateResend', () => {
  it('resolves to void on success', async () => {
    globalMock.onPost('/api/v1/auth/activate/resend').reply(201);

    await expect(postAuthActivateResend('rahim@greenview.edu.bd')).resolves.toBeUndefined();
  });

  it('turns a 429 into RateLimitedError with the Retry-After header parsed', async () => {
    globalMock
      .onPost('/api/v1/auth/activate/resend')
      .reply(429, { statusCode: 429, message: 'Too Many Requests' }, { 'retry-after': '20' });

    const error = await postAuthActivateResend('rahim@greenview.edu.bd').catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(20);
  });

  it('turns a 429 with no Retry-After header into RateLimitedError with a null wait', async () => {
    globalMock.onPost('/api/v1/auth/activate/resend').reply(429, {
      statusCode: 429,
      message: 'Too Many Requests',
    });

    const error = await postAuthActivateResend('rahim@greenview.edu.bd').catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBeNull();
  });
});

describe('postAuthForgotPassword', () => {
  it('resolves with the response, including debug when the server echoes it', async () => {
    globalMock.onPost('/api/v1/auth/forgot-password').reply(201, { debug: { otp: '123456' } });

    await expect(postAuthForgotPassword('rahim@greenview.edu.bd')).resolves.toEqual({
      debug: { otp: '123456' },
    });
  });

  it('turns a 429 into RateLimitedError with the Retry-After header parsed', async () => {
    globalMock
      .onPost('/api/v1/auth/forgot-password')
      .reply(429, { statusCode: 429, message: 'Too Many Requests' }, { 'retry-after': '15' });

    const error = await postAuthForgotPassword('rahim@greenview.edu.bd').catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(15);
  });

  it('turns a 429 with no Retry-After header into RateLimitedError with a null wait', async () => {
    globalMock.onPost('/api/v1/auth/forgot-password').reply(429, {
      statusCode: 429,
      message: 'Too Many Requests',
    });

    const error = await postAuthForgotPassword('rahim@greenview.edu.bd').catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBeNull();
  });
});

describe('postAuthResetPassword', () => {
  it('resolves with the real LoginResponse on success (token variant)', async () => {
    globalMock.onPost('/api/v1/auth/reset-password').reply(200, {
      access_token: 'tok',
      memberships: [{ tenantId: 'tenant-1', role: 'ADMIN' }],
    });

    await expect(
      postAuthResetPassword({ token: 'tok', new_password: 'hunter2fake' }),
    ).resolves.toEqual({
      access_token: 'tok',
      memberships: [{ tenantId: 'tenant-1', role: 'ADMIN' }],
    });
  });

  it('sends the phone/otp variant as-is', async () => {
    globalMock.onPost('/api/v1/auth/reset-password').reply((config) => {
      const body: unknown = JSON.parse(config.data as string);
      return [200, { access_token: 'tok', memberships: [], receivedBody: body }];
    });

    const result = (await postAuthResetPassword({
      phone: '01712345678',
      otp: '123456',
      new_password: 'hunter2fake',
    })) as unknown as { receivedBody: unknown };

    expect(result.receivedBody).toEqual({
      phone: '01712345678',
      otp: '123456',
      new_password: 'hunter2fake',
    });
  });

  it('turns a 429 into RateLimitedError with the Retry-After header parsed', async () => {
    globalMock
      .onPost('/api/v1/auth/reset-password')
      .reply(429, { statusCode: 429, message: 'Too Many Requests' }, { 'retry-after': '8' });

    const error = await postAuthResetPassword({
      token: 'tok',
      new_password: 'hunter2fake',
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(8);
  });

  it('turns a 429 with no Retry-After header into RateLimitedError with a null wait', async () => {
    globalMock.onPost('/api/v1/auth/reset-password').reply(429, {
      statusCode: 429,
      message: 'Too Many Requests',
    });

    const error = await postAuthResetPassword({
      token: 'tok',
      new_password: 'hunter2fake',
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBeNull();
  });
});
