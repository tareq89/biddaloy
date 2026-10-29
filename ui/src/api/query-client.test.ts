import { AxiosError } from 'axios';
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
  it('tunes staleTime/gcTime for cached-first rendering and shares shouldRetryQuery as the query retry default and never retries mutations', () => {
    const { queries, mutations } = createAppQueryClient().getDefaultOptions();

    expect(queries?.staleTime).toBe(30_000);
    expect(queries?.gcTime).toBe(5 * 60_000);
    expect(queries?.retry).toBe(shouldRetryQuery);
    expect(mutations?.retry).toBe(false);
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

  it('does not toast when a query fails with 403', async () => {
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    const queryClient = createAppQueryClient();

    await expect(
      queryClient.fetchQuery({
        queryKey: ['test', 'query-403'],
        queryFn: () => {
          throw apiError(403);
        },
      }),
    ).rejects.toThrow();

    expect(toastErrorSpy).not.toHaveBeenCalled();
  });

  it('shows a permission-denied toast for a mutation 403, in the active language', async () => {
    await i18n.changeLanguage('en');
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    const queryClient = createAppQueryClient();

    await expect(
      queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationFn: () => {
            throw apiError(403);
          },
        })
        .execute(undefined),
    ).rejects.toThrow();

    expect(toastErrorSpy).toHaveBeenCalledExactlyOnceWith("You don't have permission to do that.");
  });

  it('shows the restoring toast, not the permission toast, for a 423 TENANT_RESTORING mutation', async () => {
    await i18n.changeLanguage('en');
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    const queryClient = createAppQueryClient();

    await expect(
      queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationFn: () => {
            throw new ApiError({
              statusCode: 423,
              message: 'restoring',
              timestamp: new Date().toISOString(),
              path: '/x',
              requestId: 'r1',
              details: { code: 'TENANT_RESTORING' },
            });
          },
        })
        .execute(undefined),
    ).rejects.toThrow();

    expect(toastErrorSpy).toHaveBeenCalledExactlyOnceWith(
      'This school is being restored from a backup. Your change was not saved. Try again in a few minutes.',
    );
  });

  it('shows plain demo copy for a DEMO_DISABLED mutation error, not the permission toast', async () => {
    await i18n.changeLanguage('en');
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    const queryClient = createAppQueryClient();

    await expect(
      queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationFn: () => {
            throw new ApiError({
              statusCode: 403,
              message: 'demo',
              timestamp: new Date().toISOString(),
              path: '/x',
              requestId: 'r1',
              details: { code: 'DEMO_DISABLED' },
            });
          },
        })
        .execute(undefined),
    ).rejects.toThrow();

    await vi.waitFor(() =>
      expect(toastErrorSpy).toHaveBeenCalledExactlyOnceWith(
        'This is turned off in the demo school.',
      ),
    );
  });

  it.each([
    ['en', 'Demo allows at most 100 rows at a time. Your file has 250.'],
    ['bn', 'ডেমোতে একবারে সর্বোচ্চ ১০০টা সারি নেওয়া যায়। আপনার ফাইলে ২৫০টা আছে।'],
  ])('toasts the demo row cap with the file count (%s)', async (lng, text) => {
    await i18n.changeLanguage(lng);
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    const queryClient = createAppQueryClient();
    await expect(
      queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationFn: () => {
            throw new ApiError({
              statusCode: 422,
              message: 'Demo: at most 100 rows per request',
              timestamp: new Date().toISOString(),
              path: '/x',
              requestId: 'r1',
              details: { code: 'DEMO_ROW_LIMIT', limit: 100, count: 250 },
            });
          },
        })
        .execute(undefined),
    ).rejects.toThrow();
    await vi.waitFor(() => expect(toastErrorSpy).toHaveBeenCalledExactlyOnceWith(text));
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('does not toast a 403 for a mutation that handles it itself (meta.handlesForbidden)', async () => {
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    const queryClient = createAppQueryClient();

    await expect(
      queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationFn: () => {
            throw apiError(403);
          },
          meta: { handlesForbidden: true },
        })
        .execute(undefined),
    ).rejects.toThrow();

    expect(toastErrorSpy).not.toHaveBeenCalled();
  });

  it('handlesForbidden also silences DEMO_DISABLED, but never the 413 upload cap', async () => {
    await i18n.changeLanguage('en');
    const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    const queryClient = createAppQueryClient();
    const failWith = (statusCode: number, code: string) =>
      queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationFn: () => {
            throw new ApiError({
              statusCode,
              message: 'demo',
              timestamp: new Date().toISOString(),
              path: '/x',
              requestId: 'r1',
              details: { code },
            });
          },
          meta: { handlesForbidden: true },
        })
        .execute(undefined);

    // The mutation shows its own 403 message, so no second toast on top.
    await expect(failWith(403, 'DEMO_DISABLED')).rejects.toThrow();
    // A 413 is not a 403: the mutation does not explain it, so the toast still shows.
    await expect(failWith(413, 'DEMO_UPLOAD_LIMIT')).rejects.toThrow();

    await vi.waitFor(() =>
      expect(toastErrorSpy).toHaveBeenCalledExactlyOnceWith(
        'The demo school allows only small uploads.',
      ),
    );
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
        queryClient
          .getMutationCache()
          .build(queryClient, {
            mutationFn: () => {
              throw suspendedError();
            },
          })
          .execute(undefined),
      ).rejects.toThrow();

      expect(toastErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('mutations are never re-sent automatically ([2596])', () => {
    it('runs a mutation once after a 500 and shows the unknown-outcome toast', async () => {
      const toastError = vi.spyOn(toast, 'error').mockImplementation(() => '');
      const client = createAppQueryClient();
      let calls = 0;
      await expect(
        client
          .getMutationCache()
          .build(client, {
            mutationFn: () => {
              calls += 1;
              return Promise.reject(apiError(500));
            },
          })
          .execute(undefined),
      ).rejects.toThrow('boom');
      expect(calls).toBe(1);
      expect(toastError).toHaveBeenCalledTimes(1);
    });

    it('shows no unknown-outcome toast when the mutation sets handlesUnknownOutcome [2698]', async () => {
      const toastError = vi.spyOn(toast, 'error').mockImplementation(() => '');
      const client = createAppQueryClient();
      await expect(
        client
          .getMutationCache()
          .build(client, {
            mutationFn: () => Promise.reject(apiError(500)),
            meta: { handlesUnknownOutcome: true },
          })
          .execute(undefined),
      ).rejects.toThrow('boom');
      expect(toastError).not.toHaveBeenCalled();
    });

    it('shows the toast for a reply-less network error', async () => {
      const toastError = vi.spyOn(toast, 'error').mockImplementation(() => '');
      const client = createAppQueryClient();
      await expect(
        client
          .getMutationCache()
          .build(client, {
            mutationFn: () => Promise.reject(new AxiosError('Network Error')),
          })
          .execute(undefined),
      ).rejects.toThrow();
      expect(toastError).toHaveBeenCalledTimes(1);
    });

    it.each([502, 504])(
      'shows the toast for a gateway %i whose HTML body never became an ApiError',
      async (status) => {
        const toastError = vi.spyOn(toast, 'error').mockImplementation(() => '');
        const client = createAppQueryClient();
        const gateway = new AxiosError('Bad Gateway', 'ERR_BAD_RESPONSE', undefined, undefined, {
          status,
          data: '<html>Bad Gateway</html>',
        } as never);
        await expect(
          client
            .getMutationCache()
            .build(client, { mutationFn: () => Promise.reject(gateway) })
            .execute(undefined),
        ).rejects.toThrow();
        expect(toastError).toHaveBeenCalledWith(i18n.t('outcomeUnknown', { ns: 'common' }));
      },
    );

    it.each([400, 403, 409])('does not show the unknown-outcome toast for a %i', async (status) => {
      const toastError = vi.spyOn(toast, 'error').mockImplementation(() => '');
      const client = createAppQueryClient();
      await expect(
        client
          .getMutationCache()
          .build(client, { mutationFn: () => Promise.reject(apiError(status)) })
          .execute(undefined),
      ).rejects.toThrow();
      const unknown = i18n.t('outcomeUnknown', { ns: 'common' });
      expect(toastError).not.toHaveBeenCalledWith(unknown);
      if (status !== 403) expect(toastError).not.toHaveBeenCalled();
    });
  });
});
