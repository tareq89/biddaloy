import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { guardianFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useCreateGuardian, useGuardians } from './guardians';

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

  it('always requests GUARDIAN_SEARCH_LIMIT, even if a caller passes its own limit', async () => {
    let requestedLimit: string | null = null;
    server.use(
      http.get('/api/v1/guardians', ({ request }) => {
        requestedLimit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
    );

    const { result } = renderHookWithProviders(
      () => useGuardians({ search: 'Karim', limit: 100 }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedLimit).toBe('10');
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
