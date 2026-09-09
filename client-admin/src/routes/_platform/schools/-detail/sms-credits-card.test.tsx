import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { SmsCreditsCard } from './sms-credits-card';

const SCHOOL_ID = 'school-1';

describe('SmsCreditsCard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('loads and shows the balance the school already has, before any grant', async () => {
    server.use(
      http.get(`/api/v1/schools/${SCHOOL_ID}/sms-credits`, () =>
        HttpResponse.json({
          metering: 'PLATFORM',
          available: 250,
          reserved: 5,
          ledger: { data: [], total: 0, page: 1, limit: 1, totalPages: 1 },
        }),
      ),
    );

    renderWithProviders(<SmsCreditsCard schoolId={SCHOOL_ID} />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'super-admin-own-tenant',
    });

    // Region defaults to Bengali numerals regardless of UI locale.
    await waitFor(() => expect(screen.getByText('২৫০')).toBeTruthy());
    expect(screen.getByText('৫')).toBeTruthy();
  });

  it('shows the unmetered message rather than a balance when metering is OFF', async () => {
    server.use(
      http.get(`/api/v1/schools/${SCHOOL_ID}/sms-credits`, () =>
        HttpResponse.json({
          metering: 'OFF',
          available: 0,
          reserved: 0,
          ledger: { data: [], total: 0, page: 1, limit: 1, totalPages: 1 },
        }),
      ),
    );

    renderWithProviders(<SmsCreditsCard schoolId={SCHOOL_ID} />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'super-admin-own-tenant',
    });

    expect(await screen.findByText("This school isn't on platform SMS credits.")).toBeTruthy();
  });
});
