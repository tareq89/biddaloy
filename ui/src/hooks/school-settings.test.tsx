import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  schoolSettingsKeys,
  schoolSettingsQueryOptions,
  useMessagingProviders,
  useSchoolSettings,
  useTestSchoolConnection,
} from './school-settings';

describe('schoolSettingsQueryOptions', () => {
  // [8.14.5]: `useSchoolSettings` is now a one-line wrapper around this
  // factory, extracted for symmetry with `invoiceQueryOptions` even
  // though no route `loader` calls it directly today (see the factory's
  // own comment for why: `schoolId` isn't a route param). Pinning the
  // `queryKey` and `enabled` shape here proves the extraction changed
  // nothing about what `useSchoolSettings` does.
  it('uses schoolSettingsKeys.detail(schoolId) as its queryKey', () => {
    expect(schoolSettingsQueryOptions('school-1').queryKey).toEqual(
      schoolSettingsKeys.detail('school-1'),
    );
  });

  it('disables the query for an empty schoolId, same guard useSchoolSettings had before extraction', () => {
    expect(schoolSettingsQueryOptions('').enabled).toBe(false);
    expect(schoolSettingsQueryOptions('school-1').enabled).toBe(true);
  });
});

describe('useSchoolSettings', () => {
  it('resolves the settings the handler returns for the given school', async () => {
    server.use(
      http.get('/api/v1/schools/:schoolId/settings', () =>
        HttpResponse.json({ region: { timezone: 'Asia/Dhaka' } }),
      ),
    );

    const { result } = renderHookWithProviders(() => useSchoolSettings('school-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.region?.timezone).toBe('Asia/Dhaka');
  });

  it('does not fire a request for an empty schoolId', () => {
    let requested = false;
    server.use(
      http.get('/api/v1/schools/:schoolId/settings', () => {
        requested = true;
        return HttpResponse.json({});
      }),
    );

    const { result } = renderHookWithProviders(() => useSchoolSettings(''), {
      tenantId: 'tenant-1',
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(requested).toBe(false);
  });
});

describe('useMessagingProviders', () => {
  it('reads the per-medium company schema for the school', async () => {
    server.use(
      http.get('/api/v1/schools/:id/settings/messaging/providers', ({ params }) =>
        HttpResponse.json({ SMS: { providers: [], configured: true, selected: params.id } }),
      ),
    );
    const { result } = renderHookWithProviders(() => useMessagingProviders('school-1'), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.data?.SMS?.selected).toBe('school-1'));
  });
});

describe('useTestSchoolConnection', () => {
  it('sends a fresh Idempotency-Key only when sendTo is set', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post('/api/v1/schools/:id/settings/test', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        return HttpResponse.json({ success: true, message: 'ok' });
      }),
    );
    const { result } = renderHookWithProviders(() => useTestSchoolConnection('school-1'), {
      tenantId: 'tenant-1',
    });

    await result.current.mutateAsync({ medium: 'SMS' });
    await result.current.mutateAsync({ medium: 'SMS', sendTo: '01712345678' });
    await result.current.mutateAsync({ medium: 'SMS', sendTo: '01712345678' });

    expect(keys[0]).toBeNull();
    expect(keys[1]).toBeTruthy();
    expect(keys[2]).toBeTruthy();
    expect(keys[1]).not.toBe(keys[2]);
  });

  // PR #3325 finding 6: a test message is a real send, so a lost reply must get the app's
  // "could not confirm" toast. Only the plain connection test (writes nothing) opts out.
  it('opts out of the unknown-outcome toast only for a plain connection test', async () => {
    server.use(
      http.post('/api/v1/schools/:id/settings/test', () =>
        HttpResponse.json({ success: true, message: 'ok' }),
      ),
    );
    const plain = renderHookWithProviders(() => useTestSchoolConnection('school-1'), {
      tenantId: 'tenant-1',
    });
    await plain.result.current.mutateAsync({ medium: 'SMS' });
    const send = renderHookWithProviders(
      () => useTestSchoolConnection('school-1', { sendsMessage: true }),
      { tenantId: 'tenant-1' },
    );
    await send.result.current.mutateAsync({ medium: 'SMS', sendTo: '01712345678' });

    const meta = (c: typeof plain.queryClient) => c.getMutationCache().getAll()[0]?.meta;
    expect(meta(plain.queryClient)).toEqual({ handlesUnknownOutcome: true });
    expect(meta(send.queryClient)).toEqual({ handlesUnknownOutcome: false });
  });
});
