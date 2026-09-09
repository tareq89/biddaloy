import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { SmsCreditSection } from './SmsCreditSection';

const SCHOOL_ID = 'school-1';

describe('SmsCreditSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the unmetered mode label and no balance figures when metering is OFF', async () => {
    server.use(
      http.get('/api/v1/communications/sms-credits', () =>
        HttpResponse.json({
          metering: 'OFF',
          available: 0,
          reserved: 0,
          ledger: { data: [], total: 0, page: 1, limit: 10, totalPages: 1 },
        }),
      ),
    );

    renderWithProviders(<SmsCreditSection schoolId={SCHOOL_ID} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect(await screen.findByText('Own provider / unmetered')).toBeTruthy();
    expect(screen.queryByText('Available')).toBeNull();
  });

  it('shows the platform mode label with the balance', async () => {
    server.use(
      http.get('/api/v1/communications/sms-credits', () =>
        HttpResponse.json({
          metering: 'PLATFORM',
          available: 250,
          reserved: 5,
          ledger: { data: [], total: 0, page: 1, limit: 10, totalPages: 1 },
        }),
      ),
    );

    renderWithProviders(<SmsCreditSection schoolId={SCHOOL_ID} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect(await screen.findByText('Platform credits')).toBeTruthy();
    // Region defaults to Bengali numerals regardless of UI locale — this
    // is the exact behavior #570 fixed (raw Latin digits before).
    await waitFor(() => expect(screen.getByText('২৫০')).toBeTruthy());
    expect(screen.getByText('৫')).toBeTruthy();
  });

  it('reads a SUPER_ADMIN-picked school through the cross-school route, not the tenant one', async () => {
    const PICKED_SCHOOL_ID = 'school-2';
    let hitTenantRoute = false;
    server.use(
      http.get('/api/v1/communications/sms-credits', () => {
        hitTenantRoute = true;
        return HttpResponse.json({
          metering: 'OFF',
          available: 0,
          reserved: 0,
          ledger: { data: [], total: 0, page: 1, limit: 10, totalPages: 1 },
        });
      }),
      http.get(`/api/v1/schools/${PICKED_SCHOOL_ID}/sms-credits`, () =>
        HttpResponse.json({
          metering: 'PLATFORM',
          available: 40,
          reserved: 1,
          ledger: { data: [], total: 0, page: 1, limit: 10, totalPages: 1 },
        }),
      ),
    );

    renderWithProviders(<SmsCreditSection schoolId={PICKED_SCHOOL_ID} isSuperAdmin />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'super-admin-own-tenant',
    });

    await waitFor(() => expect(screen.getByText('৪০')).toBeTruthy());
    expect(hitTenantRoute).toBe(false);
  });
});
