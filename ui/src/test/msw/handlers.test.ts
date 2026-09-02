import axios from 'axios';
import { HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { setActiveTenant } from '../../api/auth-state';
import { apiClient } from '../../api/client';
import { ApiError } from '../../api/errors';

import { authHandlers } from './handlers/auth';
import { studentHandlers } from './handlers/students';
import { server } from './server';
import { errorHandler, slowHandler, tenantEchoHandler } from './support';

/**
 * These run against `apiClient` (the real axios instance from
 * `ui/src/api/client.ts`), not raw `fetch`, so a handler match here means
 * a real consumer's request would actually be intercepted too — unlike
 * `./msw.spec.ts`, which deliberately hits fabricated `https://example.
 * test` URLs to test MSW's own plumbing in isolation, this file tests the
 * handler *library*. `apiClient`'s relative `baseURL` ('/api/v1') only
 * resolves against a `location` — jsdom provides one, plain Node doesn't
 * — which is why this file is `.test.ts` (the `ui:jsdom` project) rather
 * than `.spec.ts` (`ui:node`, where `./msw.spec.ts` lives).
 */

afterEach(() => setActiveTenant(null));

describe('pagination honours page/limit', () => {
  it('slices to the requested page and reports correct totals', async () => {
    setActiveTenant('tenant-1');

    const full = await apiClient.get('/students');
    expect(full.data.total).toBe(3);
    expect(full.data.data).toHaveLength(3); // default limit (10) covers all 3 fixtures

    const paged = await apiClient.get('/students', { params: { page: 2, limit: 1 } });
    expect(paged.data.page).toBe(2);
    expect(paged.data.limit).toBe(1);
    expect(paged.data.total).toBe(3);
    expect(paged.data.totalPages).toBe(3);
    expect(paged.data.data).toHaveLength(1);
    // Page 2 of 1-per-page is the second fixture, not the first — proves
    // it's actually slicing, not just echoing the full set back.
    expect(paged.data.data[0].id).not.toBe(full.data.data[0].id);
  });

  it('the listEmpty variant reports zero results, not a slice of the default fixtures', async () => {
    setActiveTenant('tenant-1');
    server.use(studentHandlers.listEmpty);

    const res = await apiClient.get('/students');
    expect(res.data).toEqual({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
  });
});

describe('auth handlers', () => {
  // Auth endpoints go through raw `axios`, not `apiClient` — same reasoning
  // as `client.ts`'s own refresh call: logging in happens before any
  // tenant is active, so `apiClient`'s request interceptor would reject
  // every one of these with `NoActiveTenantError` before a request is even
  // sent.
  const auth = axios.create({ baseURL: '/api/v1' });

  it('login succeeds with an access token and at least one membership', async () => {
    const res = await auth.post('/auth/login', { email: 'a@b.com', password: 'x' });
    expect(res.data.access_token).toBeTypeOf('string');
    expect(res.data.memberships.length).toBeGreaterThan(0);
  });

  it('loginInvalidCredentials rejects with a 401', async () => {
    server.use(authHandlers.loginInvalidCredentials);

    await expect(
      auth.post('/auth/login', { email: 'a@b.com', password: 'wrong' }),
    ).rejects.toMatchObject({
      response: { status: 401 },
    });
  });

  it('refresh rotates the access token', async () => {
    const res = await auth.post('/auth/refresh');
    expect(res.data.access_token).toBe('mock-refreshed-access-token');
  });

  it('refreshFailure rejects with a 401, modeling an expired/invalid refresh token', async () => {
    server.use(authHandlers.refreshFailure);

    await expect(auth.post('/auth/refresh')).rejects.toMatchObject({ response: { status: 401 } });
  });

  it('logout and logout-all both return 204', async () => {
    const [logout, logoutAll] = await Promise.all([
      auth.post('/auth/logout'),
      auth.post('/auth/logout-all'),
    ]);
    expect(logout.status).toBe(204);
    expect(logoutAll.status).toBe(204);
  });
});

describe('tenant header is observable by a test', () => {
  it('tenantEchoHandler reports the X-Tenant-ID a real request actually sent', async () => {
    setActiveTenant('tenant-xyz');
    server.use(tenantEchoHandler('get', '/api/v1/probe'));

    const res = await apiClient.get('/probe');
    expect(res.data.tenantId).toBe('tenant-xyz');
  });
});

describe('error variant is selectable per test', () => {
  it('errorHandler overrides a default handler with an arbitrary status/message', async () => {
    setActiveTenant('tenant-1');
    server.use(errorHandler('get', '/api/v1/audit-logs', 403, 'Forbidden for this role'));

    try {
      await apiClient.get('/audit-logs');
      expect.unreachable('expected the request to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(403);
      expect((err as ApiError).message).toBe('Forbidden for this role');
    }
  });
});

describe('slow variant is selectable per test', () => {
  it('slowHandler adds artificial latency before resolving', async () => {
    setActiveTenant('tenant-1');
    server.use(
      slowHandler(
        'get',
        '/api/v1/students',
        () => HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
        40,
      ),
    );

    const start = Date.now();
    await apiClient.get('/students');
    expect(Date.now() - start).toBeGreaterThanOrEqual(35);
  });
});

describe('schools settings handler', () => {
  it('a second PATCH does not discard fields the first PATCH set', async () => {
    setActiveTenant('tenant-1');
    const schoolId = 'school-1';

    await apiClient.patch(`/schools/${schoolId}/settings`, {
      version: 1,
      communications: { email: { host: 'smtp.new-host.com' } },
    });
    await apiClient.patch(`/schools/${schoolId}/settings`, {
      version: 1,
      communications: { sms: { provider: 'mimsms' } },
    });

    const res = await apiClient.get(`/schools/${schoolId}/settings`);
    // Without a persisted per-school store, this second PATCH's response
    // would be built from the same default every request starts from,
    // silently reverting the first PATCH's host change.
    expect(res.data.communications.email.host).toBe('smtp.new-host.com');
    expect(res.data.communications.sms.provider).toBe('mimsms');
  });

  it('omits the hint for a secret four characters or shorter', async () => {
    setActiveTenant('tenant-1');
    const schoolId = 'school-2';

    const res = await apiClient.patch(`/schools/${schoolId}/settings`, {
      version: 1,
      communications: { sms: { greenweb: { apiKey: 'ab12' } } },
    });

    // `.slice(-4)` on a 4-character value returns the whole plaintext
    // secret — the hint must be omitted rather than echo it back.
    expect(res.data.communications.sms.greenweb.apiKey).toEqual({ configured: true });
  });
});

describe('every endpoint group is wired into the aggregate handler array', () => {
  // One representative *default* (no server.use) request per group, listed
  // paginated ones and one-off ones separately since they assert a
  // different shape — this is the actual registration check: if a group's
  // `*DefaultHandlers` array were dropped from `handlers.ts`, the request
  // would 401/404 into an unhandled-request error instead of resolving.
  const paginatedGroups: [name: string, path: string][] = [
    ['academic-years', '/academic-years'],
    ['classes', '/classes'],
    ['users', '/users'],
    ['teachers', '/teachers'],
    ['students', '/students'],
    ['guardians', '/guardians'],
    ['fee-structures', '/fee-structures'],
    ['fees/dues', '/fees/dues'],
    ['invoices', '/invoices'],
    ['audit-logs', '/audit-logs'],
  ];

  it.each(paginatedGroups)('%s responds with a paginated envelope', async (_name, path) => {
    setActiveTenant('tenant-1');

    const res = await apiClient.get(path);

    expect(res.data.data.length).toBeGreaterThan(0);
    expect(res.data.total).toBeGreaterThan(0);
  });

  it('enrollments responds to a by-student lookup', async () => {
    setActiveTenant('tenant-1');

    const res = await apiClient.get(`/enrollments/student/${crypto.randomUUID()}`);

    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data.length).toBeGreaterThan(0);
  });

  it('payments responds to a by-student lookup', async () => {
    setActiveTenant('tenant-1');

    const res = await apiClient.get(`/payments/student/${crypto.randomUUID()}`);

    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data.length).toBeGreaterThan(0);
  });

  it('communications responds to a get-by-id lookup', async () => {
    setActiveTenant('tenant-1');

    const res = await apiClient.get(`/communications/${crypto.randomUUID()}`);

    expect(res.data.id).toBeTypeOf('string');
  });

  // [8.14.2]'s `useCurrentUser` — guards correction 3 (`/users/me` must
  // resolve under the default handler set, registered *before* the more
  // general `/users/:id` handler, not after — see `handlers/users.ts`'s
  // own comment on registration order).
  it('users/me resolves under the default handler set', async () => {
    setActiveTenant('tenant-1');

    const res = await apiClient.get('/users/me');

    expect(res.data.full_name).toBeTypeOf('string');
  });
});
