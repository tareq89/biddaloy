import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { setActiveTenant } from '../api/auth-state';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useTenantRegionConfig } from './use-tenant-region-config';

function settingsResponse(currencyCode: string) {
  return {
    version: 1,
    region: {
      locale: 'en-BD',
      currency: {
        code: currencyCode,
        symbol: '$',
        position: 'prefix',
        decimals: 2,
        grouping: 'thousand',
      },
      numerals: 'latin',
      date: { format: 'YYYY-MM-DD', firstDayOfWeek: 0, calendar: 'gregory' },
      phone: {
        country: '1',
        pattern: '^\\d{10}$',
        example: '2125551234',
        displayFormat: 'XXX-XXX-XXXX',
      },
      address: { fields: ['street'], order: ['street'] },
      academicYear: { startMonth: 9 },
      identifiers: { national: '', student: '' },
      timezone: 'America/New_York',
    },
  };
}

describe('useTenantRegionConfig', () => {
  // `renderHookWithProviders` wraps only `QueryClientProvider` (see its
  // own comment: no router yet, and no I18nProvider either — the app's
  // real locale-switching integration is `App.tsx`'s job, not this
  // helper's), so `useLocale()` inside the hook reads the shared i18n
  // singleton's current language rather than anything scoped to a test.
  // Not asserted on here for that reason; `region-config-resolver.spec.ts`
  // already covers the locale-fallback shape directly, without needing a
  // real i18next instance.

  it('resolves the active tenant’s stored region settings into a RegionConfig', async () => {
    server.use(
      http.get('/api/v1/schools/:id/settings', () => HttpResponse.json(settingsResponse('CAD'))),
    );

    const { result } = renderHookWithProviders(() => useTenantRegionConfig(), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => {
      expect(result.current.currency.code).toBe('CAD');
    });
    expect(result.current.timezone).toBe('America/New_York');
    expect(result.current.academicYear.startMonth).toBe(9);
  });

  it('falls back to a default RegionConfig while settings are still loading', () => {
    server.use(
      http.get('/api/v1/schools/:id/settings', async () => {
        await new Promise(() => {}); // never resolves within this test
      }),
    );

    const { result } = renderHookWithProviders(() => useTenantRegionConfig(), {
      tenantId: 'tenant-1',
    });

    // Some real, complete RegionConfig — never `undefined`/partial —
    // regardless of which locale default it happens to be.
    expect(result.current.currency.code).toBeTruthy();
    expect(result.current.phone.pattern).toBeInstanceOf(RegExp);
  });

  it('re-resolves once the active tenant switches and the component re-renders — two tenants with different currency settings resolve to different configs', async () => {
    server.use(
      http.get('/api/v1/schools/tenant-a/settings', () =>
        HttpResponse.json(settingsResponse('BDT')),
      ),
      http.get('/api/v1/schools/tenant-b/settings', () =>
        HttpResponse.json(settingsResponse('USD')),
      ),
    );

    const { result, rerender } = renderHookWithProviders(() => useTenantRegionConfig(), {
      tenantId: 'tenant-a',
    });

    await waitFor(() => {
      expect(result.current.currency.code).toBe('BDT');
    });

    // The same mechanism a real tenant switch uses (`switchActiveTenant`
    // also calls `setActiveTenant` before clearing the query cache) —
    // `rerender()` stands in for whatever causes the consuming component
    // to render again after the switch.
    setActiveTenant('tenant-b');
    rerender();

    await waitFor(() => {
      expect(result.current.currency.code).toBe('USD');
    });
  });

  it('a tenant with no stored region settings behaves exactly like a fresh default — no crash, no partial config', async () => {
    server.use(
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({ version: 1, region: undefined }),
      ),
    );

    const { result } = renderHookWithProviders(() => useTenantRegionConfig(), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => {
      expect(result.current).toBeTruthy();
    });
    expect(result.current.currency.code).toBeTruthy();
    expect(result.current.address.fields.length).toBeGreaterThan(0);
    expect(result.current).toEqual(expect.objectContaining({ locale: expect.any(String) }));
  });
});
