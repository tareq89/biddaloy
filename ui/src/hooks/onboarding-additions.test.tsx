// [13.4.1] Tests for the onboarding-epic additions to existing hook files
// (auth, users, bulk-upload, backup, school-settings); the brand-new hook
// files have their own `*.test.tsx` next to them.
import { File as NodeFile } from 'node:buffer';

import { QueryClient } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearAuthState, getAccessToken, setAccessToken } from '../api/auth-state';
import { RateLimitedError } from '../api/errors';
import { loginResponseFactory } from '../test/msw/handlers/auth';
import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { requestOtp, setFirstPassword, verifyOtp } from './auth';
import { downloadWorkbookTemplate } from './backup';
import { useCommitStaffUpload, useValidateStaffUpload } from './bulk-upload';
import { schoolsKeys, useExtendTrial, useSchools } from './school-settings';
import { useLeaveSchool, useRestoreMember, useUsers, userKeys } from './users';

afterEach(() => {
  clearAuthState();
});

describe('requestOtp / verifyOtp (identifier)', () => {
  it('sends `identifier` on request', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/auth/otp/request', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ sent: true });
      }),
    );
    await requestOtp('a@b.c');
    expect(body).toEqual({ identifier: 'a@b.c' });
  });

  it('maps a 429 to RateLimitedError', async () => {
    server.use(
      http.post(
        '/api/v1/auth/otp/request',
        () => new HttpResponse(null, { status: 429, headers: { 'retry-after': '30' } }),
      ),
    );
    await expect(requestOtp('a@b.c')).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('verify sends identifier, adopts the session and returns the password flags', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/auth/otp/verify', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          ...loginResponseFactory({ access_token: 'otp-token' }),
          needs_password: true,
          password_required: false,
        });
      }),
    );
    const result = await verifyOtp(new QueryClient(), { identifier: 'a@b.c', otp: '123456' });
    expect(body).toEqual({ identifier: 'a@b.c', otp: '123456' });
    expect(result).toMatchObject({ needs_password: true, password_required: false });
    expect(getAccessToken()).toBe('otp-token');
  });

  it('verify surfaces a wrong code as ApiError', async () => {
    server.use(
      http.post('/api/v1/auth/otp/verify', () =>
        HttpResponse.json(apiErrorBody(401, 'bad', '/api/v1/auth/otp/verify'), { status: 401 }),
      ),
    );
    await expect(
      verifyOtp(new QueryClient(), { identifier: 'a@b.c', otp: '0' }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('setFirstPassword', () => {
  it('POSTs the password (204)', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/account/first-password', async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    setAccessToken('t');
    await renderHookAndSet();
    expect(body).toEqual({ password: 'Sup3r-secret' });
  });

  it('surfaces 409 as ApiError', async () => {
    server.use(
      http.post('/api/v1/account/first-password', () =>
        HttpResponse.json(apiErrorBody(409, 'exists', '/api/v1/account/first-password'), {
          status: 409,
        }),
      ),
    );
    await expect(renderHookAndSet()).rejects.toMatchObject({ statusCode: 409 });
  });
});

/** `apiClient` needs an active tenant, which the hook-render helper sets. */
async function renderHookAndSet(): Promise<void> {
  renderHookWithProviders(() => null, { tenantId: 'tenant-1', accessToken: 't' });
  await setFirstPassword('Sup3r-secret');
}

describe('users additions', () => {
  it('useUsers sends membership=former', async () => {
    let params: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/users', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
      }),
    );
    const { result } = renderHookWithProviders(() => useUsers({ membership: 'former' }), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((params as URLSearchParams | null)?.get('membership')).toBe('former');
  });

  it('useLeaveSchool POSTs /users/me/leave and invalidates users', async () => {
    let called = false;
    server.use(
      http.post('/api/v1/users/me/leave', () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result, queryClient } = renderHookWithProviders(() => useLeaveSchool(), {
      tenantId: 'tenant-1',
    });
    queryClient.setQueryData(userKeys.list({}), {});
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(called).toBe(true);
    expect(queryClient.getQueryState(userKeys.list({}))?.isInvalidated).toBe(true);
  });

  it('useLeaveSchool surfaces the ApiError shape (last admin)', async () => {
    server.use(
      http.post('/api/v1/users/me/leave', () =>
        HttpResponse.json(apiErrorBody(409, 'last admin', '/api/v1/users/me/leave'), {
          status: 409,
        }),
      ),
    );
    const { result } = renderHookWithProviders(() => useLeaveSchool(), { tenantId: 'tenant-1' });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ statusCode: 409 });
  });

  it('useRestoreMember POSTs /users/:id/restore and invalidates users', async () => {
    let id: unknown;
    server.use(
      http.post('/api/v1/users/:id/restore', ({ params }) => {
        id = params.id;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result, queryClient } = renderHookWithProviders(() => useRestoreMember(), {
      tenantId: 'tenant-1',
    });
    queryClient.setQueryData(userKeys.list({}), {});
    result.current.mutate('u-9');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(id).toBe('u-9');
    expect(queryClient.getQueryState(userKeys.list({}))?.isInvalidated).toBe(true);
  });

  it('useRestoreMember surfaces the ApiError shape', async () => {
    server.use(
      http.post('/api/v1/users/:id/restore', () =>
        HttpResponse.json(apiErrorBody(409, 'seat limit', '/x'), { status: 409 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useRestoreMember(), { tenantId: 'tenant-1' });
    result.current.mutate('u-9');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ statusCode: 409 });
  });
});

function csv(): File {
  return new NodeFile(['name,role\nA,TEACHER'], 'staff.csv', {
    type: 'text/csv',
  }) as unknown as File;
}

describe('staff bulk upload', () => {
  it('validate returns a PreviewResult with the create/restore/skip summary', async () => {
    server.use(
      http.post('/api/v1/users/bulk-upload/validate', () =>
        HttpResponse.json(
          {
            staging_id: 's-1',
            expires_at: '2026-01-01T00:00:00.000Z',
            summary: { create: 1, restore: 0, skip: 0 },
            rows: [{ action: 'create', row: 2, name: 'A', role: 'TEACHER', notes: [] }],
            errors: [],
            hard_error_count: 0,
          },
          { status: 201 },
        ),
      ),
    );
    const { result } = renderHookWithProviders(() => useValidateStaffUpload(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await act(async () => {
      const res = await result.current.mutateAsync({ file: csv() });
      expect(res.staging_id).toBe('s-1');
      expect(res.summary.summary.create).toBe(1);
      expect(res.summary.rows).toHaveLength(1);
    });
  });

  it('validate maps an expired stage (410) to a status-shaped error', async () => {
    server.use(
      http.post('/api/v1/users/bulk-upload/validate', () =>
        HttpResponse.json(apiErrorBody(410, 'gone', '/x'), { status: 410 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useValidateStaffUpload(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await act(async () => {
      await expect(result.current.mutateAsync({ file: csv() })).rejects.toMatchObject({
        status: 410,
      });
    });
  });

  it('commit posts staging id + send_invitations, returns invite_failed, invalidates users', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/users/bulk-upload/commit', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            created: 1,
            restored: 0,
            skipped: 0,
            invited: 0,
            failed: [],
            invite_failed: [{ row: 2, reason: 'no channel' }],
          },
          { status: 201 },
        );
      }),
    );
    const { result, queryClient } = renderHookWithProviders(() => useCommitStaffUpload(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    queryClient.setQueryData(userKeys.list({}), {});
    await act(async () => {
      const res = await result.current.mutateAsync({ stagingId: 's-1', sendInvitations: true });
      expect(res.invite_failed).toHaveLength(1);
    });
    expect(body).toEqual({ staging_id: 's-1', send_invitations: true });
    expect(queryClient.getQueryState(userKeys.list({}))?.isInvalidated).toBe(true);
  });

  it('commit maps an expired stage (404) to a status-shaped error', async () => {
    server.use(
      http.post('/api/v1/users/bulk-upload/commit', () =>
        HttpResponse.json(apiErrorBody(404, 'gone', '/x'), { status: 404 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useCommitStaffUpload(), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ stagingId: 's-1', sendInvitations: false }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});

describe('downloadWorkbookTemplate variant', () => {
  it('sends variant=starter alongside lang', async () => {
    let params: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/backup/template', ({ request }) => {
        params = new URL(request.url).searchParams;
        return new HttpResponse('x', { headers: { 'content-type': 'application/octet-stream' } });
      }),
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    renderHookWithProviders(() => null, { tenantId: 'tenant-1', role: 'ADMIN' });
    await downloadWorkbookTemplate('en', { variant: 'starter' });
    expect((params as URLSearchParams | null)?.get('variant')).toBe('starter');
    expect((params as URLSearchParams | null)?.get('lang')).toBe('en');
  });
});

describe('platform schools trial', () => {
  it('useSchools forwards the trial filter and returns the trial fields', async () => {
    let trial: string | null = null;
    server.use(
      http.get('/api/v1/schools', ({ request }) => {
        trial = new URL(request.url).searchParams.get('trial');
        return HttpResponse.json([
          {
            id: 's1',
            name: 'S',
            slug: 's',
            status: 'ACTIVE',
            created_at: '2026-01-01T00:00:00.000Z',
            country_code: 'BD',
            trial_ends_at: '2026-02-01T00:00:00.000Z',
            seat_limit: 10,
            status_reason: null,
          },
        ]);
      }),
    );
    const { result } = renderHookWithProviders(() => useSchools({ trial: 'active' }), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(trial).toBe('active');
    expect(result.current.data?.[0]?.seat_limit).toBe(10);
  });

  it('useExtendTrial PATCHes the trial and invalidates the school lists', async () => {
    let body: unknown;
    server.use(
      http.patch('/api/v1/schools/:id/trial', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 's1' });
      }),
    );
    const { result, queryClient } = renderHookWithProviders(() => useExtendTrial('s1'), {
      tenantId: 'tenant-1',
    });
    queryClient.setQueryData(schoolsKeys.lists(), []);
    result.current.mutate({ days: 14, reason: 'pilot' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ days: 14, reason: 'pilot' });
    expect(queryClient.getQueryState(schoolsKeys.lists())?.isInvalidated).toBe(true);
  });

  it('useExtendTrial surfaces the ApiError shape (403)', async () => {
    server.use(
      http.patch('/api/v1/schools/:id/trial', () =>
        HttpResponse.json(apiErrorBody(403, 'no', '/x'), { status: 403 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useExtendTrial('s1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({ days: 1, reason: 'x' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ statusCode: 403 });
  });
});
