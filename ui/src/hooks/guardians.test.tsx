import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { guardianFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import {
  guardianKeys,
  useCreateGuardian,
  useDeleteGuardian,
  useGuardian,
  useGuardians,
  useUpdateGuardian,
} from './guardians';

describe('useGuardians', () => {
  it('resolves with the search results', async () => {
    const guardians = [
      guardianFactory({ full_name: 'Karim Rahman' }),
      guardianFactory({ full_name: 'Karim Uddin' }),
    ];
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: guardians, total: 2, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { result } = renderHookWithProviders(() => useGuardians({ search: 'Karim' }), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.map((g) => g.full_name)).toEqual([
      'Karim Rahman',
      'Karim Uddin',
    ]);
  });

  it('sends the search term and a small result-limit as query params', async () => {
    let requestedSearch: string | null = null;
    let requestedLimit: string | null = null;
    server.use(
      http.get('/api/v1/guardians', ({ request }) => {
        const url = new URL(request.url);
        requestedSearch = url.searchParams.get('search');
        requestedLimit = url.searchParams.get('limit');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
    );

    const { result } = renderHookWithProviders(() => useGuardians({ search: 'Karim' }), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedSearch).toBe('Karim');
    expect(requestedLimit).toBe('10');
  });

  it('honors a caller-supplied limit, for the paginated Guardians list page', async () => {
    let requestedLimit: string | null = null;
    server.use(
      http.get('/api/v1/guardians', ({ request }) => {
        requestedLimit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => useGuardians({ search: 'Karim', limit: 100 }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedLimit).toBe('100');
  });
});

describe('useCreateGuardian', () => {
  it('posts the input and resolves with the created guardian', async () => {
    const created = guardianFactory({ full_name: 'Karim Rahman' });
    server.use(http.post('/api/v1/guardians', () => HttpResponse.json(created, { status: 201 })));

    const { result } = renderHookWithProviders(() => useCreateGuardian(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({ full_name: 'Karim Rahman', relationship: 'Father' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.full_name).toBe('Karim Rahman');
  });
});

// [8.11.4]'s detail page.
describe('useGuardian fetches a single guardian by id', () => {
  it('resolves with the guardian the handler returns for that id', async () => {
    server.use(
      http.get('/api/v1/guardians/:id', ({ params }) =>
        HttpResponse.json(guardianFactory({ id: params.id as string, full_name: 'Solo Guardian' })),
      ),
    );

    const { result } = renderHookWithProviders(() => useGuardian('guardian-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('guardian-1');
    expect(result.current.data?.full_name).toBe('Solo Guardian');
  });

  it('stays disabled and issues no request when id is undefined', () => {
    let requestCount = 0;
    server.use(
      http.get('/api/v1/guardians/:id', () => {
        requestCount += 1;
        return HttpResponse.json(guardianFactory());
      }),
    );

    const { result } = renderHookWithProviders(() => useGuardian(undefined), {
      tenantId: 'tenant-1',
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(requestCount).toBe(0);
  });
});

describe('useUpdateGuardian', () => {
  it('patches the guardian and invalidates its detail and every list variant', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      guardianKeys.detail('guardian-1'),
      guardianFactory({ id: 'guardian-1', full_name: 'Old Name' }),
    );

    server.use(
      http.patch('/api/v1/guardians/:id', async ({ params, request }) => {
        const body = (await request.json()) as { full_name: string };
        return HttpResponse.json(
          guardianFactory({ id: params.id as string, full_name: body.full_name }),
        );
      }),
    );

    const { result } = renderHookWithProviders(() => useUpdateGuardian('guardian-1'), {
      tenantId: 'tenant-1',
      queryClient,
    });

    result.current.mutate({ full_name: 'New Name' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.full_name).toBe('New Name');
  });
});

describe('useDeleteGuardian', () => {
  it('removes the guardian from cache and invalidates every list variant', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      guardianKeys.detail('guardian-1'),
      guardianFactory({ id: 'guardian-1' }),
    );

    let deleteCalledWith: string | null = null;
    server.use(
      http.delete('/api/v1/guardians/:id', ({ params }) => {
        deleteCalledWith = params.id as string;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    const { result } = renderHookWithProviders(() => useDeleteGuardian(), {
      tenantId: 'tenant-1',
      queryClient,
    });

    result.current.mutate('guardian-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteCalledWith).toBe('guardian-1');
    expect(queryClient.getQueryData(guardianKeys.detail('guardian-1'))).toBeUndefined();
  });
});
