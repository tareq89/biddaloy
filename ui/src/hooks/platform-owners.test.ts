import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../api/errors';
import { server } from '../test/msw/server';
import { apiErrorBody, errorHandler } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import {
  useLockOwner,
  usePlatformHistory,
  usePlatformOwners,
  useUnlockOwner,
} from './platform-owners';

afterEach(async () => {
  await cleanupTestState();
});

describe('platform owners hooks', () => {
  it('usePlatformOwners: loading then the owner list', async () => {
    const { result } = renderHookWithProviders(() => usePlatformOwners());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect(result.current.data?.map((o) => o.fullName)).toEqual(['Owner One', 'Owner Two']),
    );
  });

  it('usePlatformOwners: a 403 surfaces as an ApiError', async () => {
    server.use(errorHandler('get', '*/platform/owners', 403, 'Forbidden'));
    const { result } = renderHookWithProviders(() => usePlatformOwners());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).statusCode).toBe(403);
  });

  it('usePlatformHistory: follows the cursor until it is null', async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get('*/platform/owners/history', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        return HttpResponse.json(
          cursor
            ? {
                data: [{ id: 'h2', action: 'A', actorName: null, at: 'x', label: 'second' }],
                nextCursor: null,
              }
            : {
                data: [{ id: 'h1', action: 'A', actorName: null, at: 'x', label: 'first' }],
                nextCursor: 'abc',
              },
        );
      }),
    );
    const { result } = renderHookWithProviders(() => usePlatformHistory(1));
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);
    expect(cursors).toEqual([null, 'abc']);
  });

  it.each([
    ['lock', useLockOwner],
    ['unlock', useUnlockOwner],
  ] as const)('%s: posts to the owner URL, no auto-retry on 409', async (action, useHook) => {
    let calls = 0;
    server.use(
      http.post(`*/platform/owners/:userId/${action}`, () => {
        calls += 1;
        return HttpResponse.json(apiErrorBody(409, 'Cannot do that', '/'), { status: 409 });
      }),
    );
    const { result } = renderHookWithProviders(() => useHook());
    act(() => result.current.mutate('11111111-1111-4111-8111-111111111111'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).statusCode).toBe(409);
    expect(calls).toBe(1);
  });

  it('lock: succeeds on 204 when the server asks for nothing more', async () => {
    const { result } = renderHookWithProviders(() => useLockOwner());
    await act(() => result.current.mutateAsync('11111111-1111-4111-8111-111111111111'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
