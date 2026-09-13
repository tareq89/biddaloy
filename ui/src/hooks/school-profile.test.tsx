import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useSchoolProfile } from './school-profile';

/**
 * [item 8, money-tier review] `enabled` lets `RestoreWizard` skip
 * `GET /schools/me/profile` entirely when it already has the target
 * school's name via `expectedSchoolName` (the SUPER_ADMIN
 * provision-from-workbook flow — see `restore-wizard.tsx`'s own comment).
 */
describe('useSchoolProfile enabled option', () => {
  it('does not fetch when enabled is false', async () => {
    let called = false;
    server.use(
      http.get('/api/v1/schools/me/profile', () => {
        called = true;
        return HttpResponse.json({
          name: 'Should Not Load',
          name_bn: null,
          address: null,
          phone: null,
          email: null,
          registration_id: null,
          logo_url: null,
        });
      }),
    );

    const { result } = renderHookWithProviders(() => useSchoolProfile({ enabled: false }), {
      tenantId: 'tenant-1',
    });

    // Give any accidental fetch a chance to happen before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(called).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetches when enabled is true (the default)', async () => {
    server.use(
      http.get('/api/v1/schools/me/profile', () =>
        HttpResponse.json({
          name: 'Greenview',
          name_bn: null,
          address: null,
          phone: null,
          email: null,
          registration_id: null,
          logo_url: null,
        }),
      ),
    );

    const { result } = renderHookWithProviders(() => useSchoolProfile(), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe('Greenview');
  });
});
