import { UserStatus } from '@biddaloy/shared';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { userResponseFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  useAdminResetPassword,
  useCreateUser,
  useCurrentUser,
  useRemoveMember,
  useUpdateOwnProfile,
  useUpdateUser,
  useUser,
  useUsers,
  userKeys,
} from './users';

describe('useUsers', () => {
  it('resolves with the paginated staff list', async () => {
    const users = [
      userResponseFactory({ full_name: 'Karim Rahman' }),
      userResponseFactory({ full_name: 'Karim Uddin' }),
    ];
    server.use(
      http.get('/api/v1/users', () =>
        HttpResponse.json({ data: users, total: 2, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { result } = renderHookWithProviders(() => useUsers({ search: 'Karim' }), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.map((u) => u.full_name)).toEqual([
      'Karim Rahman',
      'Karim Uddin',
    ]);
  });

  it('sends role, search, page and limit as query params', async () => {
    let params: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/users', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({ data: [], total: 0, page: 2, limit: 25, totalPages: 0 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => useUsers({ role: 'TEACHER', search: 'Karim', page: 2, limit: 25 }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(params!.get('role')).toBe('TEACHER');
    expect(params!.get('search')).toBe('Karim');
    expect(params!.get('page')).toBe('2');
    expect(params!.get('limit')).toBe('25');
  });

  // [8.14.10]: `status`/`joined_from`/`joined_to`/`sort`/`order` mirror
  // `QueryUserDto`, landed server-side by #373 but never threaded through
  // `UserListFilters` until now.
  it('[8.14.10] sends status, joined_from, joined_to, sort, and order as query params', async () => {
    let params: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/users', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
      }),
    );

    const { result } = renderHookWithProviders(
      () =>
        useUsers({
          status: UserStatus.ACTIVE,
          joined_from: '2025-01-01',
          joined_to: '2025-12-31',
          sort: 'full_name',
          order: 'asc',
        }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(params!.get('status')).toBe('ACTIVE');
    expect(params!.get('joined_from')).toBe('2025-01-01');
    expect(params!.get('joined_to')).toBe('2025-12-31');
    expect(params!.get('sort')).toBe('full_name');
    expect(params!.get('order')).toBe('asc');
  });
});

describe('useUser', () => {
  it('fetches one user by id', async () => {
    server.use(
      http.get('/api/v1/users/:id', ({ params }) =>
        HttpResponse.json(userResponseFactory({ id: params.id as string, full_name: 'Rahim' })),
      ),
    );

    const { result } = renderHookWithProviders(() => useUser('user-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('user-1');
    expect(result.current.data?.full_name).toBe('Rahim');
  });

  it('stays disabled without an id', () => {
    const { result } = renderHookWithProviders(() => useUser(undefined), {
      tenantId: 'tenant-1',
    });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCurrentUser', () => {
  it('resolves full_name against GET /users/me', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json(userResponseFactory({ id: 'user-1', full_name: 'Rahim' })),
      ),
    );

    const { result } = renderHookWithProviders(() => useCurrentUser(), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.full_name).toBe('Rahim');
  });
});

describe('useUpdateOwnProfile', () => {
  it('[8.14.4] PATCHes /users/me with the exact body and invalidates only the "me" detail key', async () => {
    let body: unknown = null;
    server.use(
      http.patch('/api/v1/users/me', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(userResponseFactory({ full_name: 'Rahim Renamed' }));
      }),
    );

    const { result, queryClient } = renderHookWithProviders(() => useUpdateOwnProfile(), {
      tenantId: 'tenant-1',
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    result.current.mutate({ full_name: 'Rahim Renamed' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ full_name: 'Rahim Renamed' });
    expect(result.current.data?.full_name).toBe('Rahim Renamed');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: userKeys.detail('me') });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: userKeys.lists() });
  });

  it('surfaces the 403 wrong-current-password case as an error', async () => {
    server.use(
      http.patch('/api/v1/users/me', () =>
        HttpResponse.json(
          { statusCode: 403, message: 'current_password is incorrect' },
          { status: 403 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useUpdateOwnProfile(), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({ email: 'new@example.com', current_password: 'wrong' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useCreateUser', () => {
  it('POSTs the exact body and returns the user plus membership', async () => {
    let body: unknown = null;
    server.use(
      http.post('/api/v1/users', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            user: userResponseFactory({ id: 'user-9' }),
            membership: { id: 'm-1', role: 'ACCOUNTANT', tenant_id: 't-1', user_id: 'user-9' },
          },
          { status: 201 },
        );
      }),
    );

    const { result } = renderHookWithProviders(() => useCreateUser(), { tenantId: 'tenant-1' });
    result.current.mutate({
      full_name: 'New Person',
      email: 'new@example.com',
      role: 'ACCOUNTANT',
      tenantId: 't-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({
      full_name: 'New Person',
      email: 'new@example.com',
      role: 'ACCOUNTANT',
      tenantId: 't-1',
    });
    expect(result.current.data?.membership.role).toBe('ACCOUNTANT');
  });

  it('surfaces a 409 duplicate-email as an error, without retrying', async () => {
    let calls = 0;
    server.use(
      http.post('/api/v1/users', () => {
        calls += 1;
        return HttpResponse.json({ statusCode: 409, message: 'duplicate' }, { status: 409 });
      }),
    );

    const { result } = renderHookWithProviders(() => useCreateUser(), { tenantId: 'tenant-1' });
    result.current.mutate({ full_name: 'Dup', role: 'ADMIN', tenantId: 't-1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });
});

describe('useUpdateUser', () => {
  it('PATCHes the profile fields', async () => {
    let body: unknown = null;
    server.use(
      http.patch('/api/v1/users/:id', async ({ params, request }) => {
        body = await request.json();
        return HttpResponse.json(userResponseFactory({ id: params.id as string }));
      }),
    );

    const { result } = renderHookWithProviders(() => useUpdateUser('user-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({ full_name: 'Renamed', phone: '+8801700000000' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ full_name: 'Renamed', phone: '+8801700000000' });
  });
});

describe('useRemoveMember', () => {
  it('DELETEs the membership', async () => {
    let deletedId: string | null = null;
    server.use(
      http.delete('/api/v1/users/:id', ({ params }) => {
        deletedId = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result } = renderHookWithProviders(() => useRemoveMember(), { tenantId: 'tenant-1' });
    result.current.mutate('user-2');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deletedId).toBe('user-2');
  });

  it('surfaces the self-removal 400 as an error', async () => {
    server.use(
      http.delete('/api/v1/users/:id', () =>
        HttpResponse.json(
          { statusCode: 400, message: 'You cannot remove your own account from this school' },
          { status: 400 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useRemoveMember(), { tenantId: 'tenant-1' });
    result.current.mutate('me');

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useAdminResetPassword', () => {
  it('resolves with the channel and expiry the server picked', async () => {
    server.use(
      http.post('/api/v1/users/:id/reset-password', () =>
        HttpResponse.json({ channel: 'EMAIL', expires_at: '2026-01-01T00:00:00.000Z' }),
      ),
    );

    const { result } = renderHookWithProviders(() => useAdminResetPassword('user-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      channel: 'EMAIL',
      expires_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('surfaces a cross-tenant 404 as an error', async () => {
    server.use(
      http.post('/api/v1/users/:id/reset-password', () =>
        HttpResponse.json(
          { statusCode: 404, message: 'User with ID "user-1" not found' },
          { status: 404 },
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useAdminResetPassword('user-1'), {
      tenantId: 'tenant-1',
    });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
