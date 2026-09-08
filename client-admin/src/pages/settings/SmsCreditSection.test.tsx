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
    await waitFor(() => expect(screen.getByText('250')).toBeTruthy());
    expect(screen.getByText('5')).toBeTruthy();
  });
});
