import { afterEach, describe, expect, it, vi } from 'vitest';

import { toast } from '../components/toast';
import { shouldRetryQuery } from '../hooks/retry';
import { i18n } from '../i18n';
import { DEFAULT_LOCALE } from '../i18n/locale-storage';

import { ApiError } from './errors';
import { createAppQueryClient } from './query-client';

function apiError(statusCode: number): ApiError {
  return new ApiError({
    statusCode,
    message: 'boom',
    timestamp: new Date().toISOString(),
    path: '/x',
    requestId: 'r1',
  });
}

// `cleanupTestState()` (wired into `afterEach` by `src/test/setup.ts`) only
// resets state `renderWithProviders` itself touches — this file never calls
// `renderWithProviders`, so the language switch below needs its own
// teardown to avoid leaking into the next test file's default-locale
// assumptions, same concern `cleanupTestState`'s own doc comment raises.
afterEach(async () => {
  await i18n.changeLanguage(DEFAULT_LOCALE);
});

describe('createAppQueryClient', () => {
  it('tunes staleTime/gcTime for cached-first rendering and shares shouldRetryQuery as the default retry', () => {
    const { queries, mutations } = createAppQueryClient().getDefaultOptions();

    expect(queries?.staleTime).toBe(30_000);
    expect(queries?.gcTime).toBe(5 * 60_000);
    expect(queries?.retry).toBe(shouldRetryQuery);
    expect(mutations?.retry).toBe(shouldRetryQuery);
  });

  it('runs queries offline-first, so a query with no data still calls its queryFn while offline', async () => {
    const queryClient = createAppQueryClient();
    expect(queryClient.getDefaultOptions().queries?.networkMode).toBe('offlineFirst');

    // The reason the option exists ([8.12.6]): under TanStack Query's
    // default `online` mode this query would be *paused* and its promise
    // would never settle, which is exactly what made an offline route
    // navigation hang forever on the previous screen — and what stopped
    // the service-worker cache and `offlineCachedQueryFn`'s Dexie
    // fallback, both of which live inside the query function, from ever
    // being consulted.
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const data = await queryClient.fetchQuery({
        queryKey: ['test', 'offline'],
        queryFn: () => Promise.resolve('served from a cache the queryFn owns'),
      });
      expect(data).toBe('served from a cache the queryFn owns');
    } finally {
      onLine.mockRestore();
    }
  });

  it('excludes 4xx from the client-level retry default — one call, then gives up', async () => {
    const queryClient = createAppQueryClient();
    let callCount = 0;

    await expect(
      queryClient.fetchQuery({
        queryKey: ['test', '403'],
        queryFn: () => {
          callCount += 1;
          throw apiError(403);
        },
      }),
    ).rejects.toThrow('boom');

    expect(callCount).toBe(1);
  });

  it('shows a permission-denied toast for a 403, in the active language', async () => {
    await i18n.changeLanguage('en');
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    const queryClient = createAppQueryClient();

    await expect(
      queryClient.fetchQuery({
        queryKey: ['test', 'toast-403'],
        queryFn: () => {
          throw apiError(403);
        },
      }),
    ).rejects.toThrow();

    expect(toastErrorSpy).toHaveBeenCalledExactlyOnceWith("You don't have permission to do that.");
  });

  it('does not toast for a non-403 ApiError or a plain Error', async () => {
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    const queryClient = createAppQueryClient();

    await expect(
      queryClient.fetchQuery({
        queryKey: ['test', '500'],
        queryFn: () => {
          throw apiError(500);
        },
        retry: false,
      }),
    ).rejects.toThrow();

    await expect(
      queryClient.fetchQuery({
        queryKey: ['test', 'plain-error'],
        queryFn: () => {
          throw new Error('not an ApiError at all');
        },
        retry: false,
      }),
    ).rejects.toThrow();

    expect(toastErrorSpy).not.toHaveBeenCalled();
  });
});
