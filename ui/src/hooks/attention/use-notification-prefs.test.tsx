/** [67.5.07] Notification prefs hooks — read, PATCH body, cache update, error. */
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../../test/msw/server';
import { renderHookWithProviders } from '../../test/render-hook-with-providers';
import { cleanupTestState } from '../../test/render-with-providers';

import { useNotificationPrefs, useUpdateNotificationPrefs } from './use-notification-prefs';

const TENANT = { tenantId: 'tenant-1' };
const QUIET = { start: '21:00', end: '07:00' };

afterEach(async () => {
  await cleanupTestState();
});

describe('notification prefs hooks', () => {
  it('reads prefs', async () => {
    const { result } = renderHookWithProviders(() => useNotificationPrefs(), TENANT);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ mutedCategories: [], quietHours: QUIET });
  });

  it('PATCHes exactly { mutedCategories } and updates the cache from the response', async () => {
    let body: unknown = null;
    server.use(
      http.patch('*/users/me/preferences/notifications', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ mutedCategories: ['FEES'], quietHours: QUIET });
      }),
    );
    const { result } = renderHookWithProviders(
      () => ({ q: useNotificationPrefs(), m: useUpdateNotificationPrefs() }),
      TENANT,
    );
    await waitFor(() => expect(result.current.q.isSuccess).toBe(true));
    result.current.m.mutate(['FEES']);
    await waitFor(() => expect(result.current.q.data?.mutedCategories).toEqual(['FEES']));
    expect(body).toEqual({ mutedCategories: ['FEES'] });
  });

  it('surfaces a 400 as an error', async () => {
    server.use(
      http.patch('*/users/me/preferences/notifications', () =>
        HttpResponse.json(
          { statusCode: 400, message: 'bad', error: 'Bad Request' },
          { status: 400 },
        ),
      ),
    );
    const { result } = renderHookWithProviders(() => useUpdateNotificationPrefs(), TENANT);
    result.current.mutate(['FEES']);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
