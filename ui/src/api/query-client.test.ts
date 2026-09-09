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
  // Vitest 4's `vi.spyOn` returns the same mock when re-spying an
  // already-spied method, carrying over an earlier test's calls — several
  // tests here spy on the same `toast.error`/`navigator.onLine`, so without
  // this a later test's `not.toHaveBeenCalled()` sees a prior test's calls.
  vi.restoreAllMocks();
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

  describe('suspended tenant [15.4.2]', () => {
    function suspendedError(): ApiError {
      return new ApiError({
        statusCode: 403,
        message: 'This school has been suspended',
        timestamp: new Date().toISOString(),
        path: '/x',
        requestId: 'r1',
        details: { code: 'TENANT_SUSPENDED' },
      });
    }

    it('rethrows a 403 TENANT_SUSPENDED to the route boundary, but not an ordinary 403', () => {
      const { queries } = createAppQueryClient().getDefaultOptions();
      const throwOnError = queries?.throwOnError as (error: unknown) => boolean;

      // The route boundary owns the full-page "school suspended" state; an
      // inline per-query error could never say that.
      expect(throwOnError(suspendedError())).toBe(true);
      expect(throwOnError(apiError(403))).toBe(false);
      expect(throwOnError(apiError(500))).toBe(false);
    });

    it('does not toast "permission denied" for a suspended tenant — the boundary page says it instead', async () => {
      const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
      const queryClient = createAppQueryClient();

      await expect(
        queryClient.fetchQuery({
          queryKey: ['test', 'suspended-403'],
          queryFn: () => {
            throw suspendedError();
          },
        }),
      ).rejects.toThrow();

      expect(toastErrorSpy).not.toHaveBeenCalled();
    });
  });
});
