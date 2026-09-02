import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  schoolSettingsKeys,
  schoolSettingsQueryOptions,
  useSchoolSettings,
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
