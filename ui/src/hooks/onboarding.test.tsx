import { useQuery } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { apiErrorBody } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { onboardingKeys, onboardingStatusQueryOptions, useUpdateOnboarding } from './onboarding';

const STATUS = {
  finished_at: null,
  dismissed_at: null,
  seen: false,
  setup_path: null,
  items: [{ id: 'profile', done: true }],
  counts: { classes: 0, sections: 0, students: 0, staff: 1 },
  trial: null,
  support_url: null,
};

describe('onboardingStatusQueryOptions', () => {
  it('resolves with the status body', async () => {
    server.use(http.get('/api/v1/onboarding/status', () => HttpResponse.json(STATUS)));
    const { result } = renderHookWithProviders(() => useQuery(onboardingStatusQueryOptions()), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(STATUS);
  });

  it('rejects with an ApiError carrying the status code', async () => {
    server.use(
      http.get('/api/v1/onboarding/status', () =>
        HttpResponse.json(apiErrorBody(403, 'nope', '/api/v1/onboarding/status'), { status: 403 }),
      ),
    );
    const { queryClient } = renderHookWithProviders(() => null, { tenantId: 'tenant-1' });
    await expect(
      queryClient.fetchQuery({ ...onboardingStatusQueryOptions(), retry: false }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('useUpdateOnboarding', () => {
  it('PATCHes the body and invalidates the status query', async () => {
    let body: unknown;
    server.use(
      http.patch('/api/v1/onboarding', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(STATUS);
      }),
    );
    const { result, queryClient } = renderHookWithProviders(() => useUpdateOnboarding(), {
      tenantId: 'tenant-1',
    });
    queryClient.setQueryData(onboardingKeys.status, STATUS);

    result.current.mutate({ setup_path: 'guided' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ setup_path: 'guided' });
    expect(queryClient.getQueryState(onboardingKeys.status)?.isInvalidated).toBe(true);
  });

  it('surfaces the ApiError shape', async () => {
    server.use(
      http.patch('/api/v1/onboarding', () =>
        HttpResponse.json(apiErrorBody(400, 'bad', '/api/v1/onboarding'), { status: 400 }),
      ),
    );
    const { result } = renderHookWithProviders(() => useUpdateOnboarding(), {
      tenantId: 'tenant-1',
    });
    result.current.mutate({ seen: true });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ statusCode: 400 });
  });
});
