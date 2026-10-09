import { useQuery } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  identitiesQueryOptions,
  socialKeys,
  socialProvidersQueryOptions,
  socialStartUrl,
  useDisconnectIdentity,
  useStartSocialLink,
} from './social';

describe('socialStartUrl', () => {
  it('builds the start URL with intent and an encoded redirect', () => {
    expect(socialStartUrl('google', 'login')).toBe('/api/v1/auth/social/google/start?intent=login');
    expect(socialStartUrl('facebook', 'register', '/a b')).toBe(
      '/api/v1/auth/social/facebook/start?intent=register&redirect=%2Fa+b',
    );
  });
});

describe('socialProvidersQueryOptions', () => {
  it('resolves with the enabled providers (no tenant needed)', async () => {
    server.use(
      http.get('/api/v1/auth/social/providers', () => HttpResponse.json({ providers: ['google'] })),
    );
    const { result } = renderHookWithProviders(() => useQuery(socialProvidersQueryOptions()));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(['google']);
  });

  it('rejects with an ApiError', async () => {
    server.use(
      http.get('/api/v1/auth/social/providers', () =>
        HttpResponse.json(apiErrorBody(500, 'boom', '/api/v1/auth/social/providers'), {
          status: 500,
        }),
      ),
    );
    const { queryClient } = renderHookWithProviders(() => null);
    await expect(
      queryClient.fetchQuery({ ...socialProvidersQueryOptions(), retry: false }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe('identitiesQueryOptions', () => {
  it('resolves with the linked identities', async () => {
    const identities = [{ provider: 'google', email: 'a@b.c', created_at: '2026-01-01T00:00:00Z' }];
    server.use(http.get('/api/v1/auth/social/identities', () => HttpResponse.json(identities)));
    const { result } = renderHookWithProviders(() => useQuery(identitiesQueryOptions()), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(identities);
  });
});

describe('useDisconnectIdentity', () => {
  it('DELETEs by provider and invalidates the identities query', async () => {
    let provider: unknown;
    server.use(
      http.delete('/api/v1/auth/social/identities/:provider', ({ params }) => {
        provider = params.provider;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result, queryClient } = renderHookWithProviders(() => useDisconnectIdentity(), {
      tenantId: 'tenant-1',
    });
    queryClient.setQueryData(socialKeys.identities, []);

    result.current.mutate('google');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(provider).toBe('google');
    expect(queryClient.getQueryState(socialKeys.identities)?.isInvalidated).toBe(true);
  });

  it('surfaces the ApiError shape', async () => {
    server.use(
      http.delete('/api/v1/auth/social/identities/:provider', () =>
        HttpResponse.json(apiErrorBody(409, 'last sign-in method', '/x'), { status: 409 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useDisconnectIdentity(), {
      tenantId: 'tenant-1',
    });
    result.current.mutate('google');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ statusCode: 409 });
  });
});

describe('useStartSocialLink', () => {
  it('POSTs link-start and resolves with the provider URL', async () => {
    server.use(
      http.post('/api/v1/auth/social/:provider/link-start', () =>
        HttpResponse.json({ url: 'https://accounts.example/auth' }),
      ),
    );
    const { result } = renderHookWithProviders(() => useStartSocialLink(), {
      tenantId: 'tenant-1',
    });
    await expect(result.current.mutateAsync('google')).resolves.toBe(
      'https://accounts.example/auth',
    );
  });

  it('surfaces the ApiError shape', async () => {
    server.use(
      http.post('/api/v1/auth/social/:provider/link-start', () =>
        HttpResponse.json(apiErrorBody(400, 'unknown provider', '/x'), { status: 400 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useStartSocialLink(), {
      tenantId: 'tenant-1',
    });
    await expect(result.current.mutateAsync('google')).rejects.toMatchObject({ statusCode: 400 });
  });
});
