import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { SmsCreditSection } from './SmsCreditSection';

const SCHOOL_ID = 'school-1';
const EXTRAS = {
  lots: [],
  orders: [],
  source: 'SCHOOLMANAGERP',
  almostFinished: false,
  stopped: false,
};

function creditsWith(over: Record<string, unknown>) {
  return http.get('/api/v1/communications/sms-credits', () =>
    HttpResponse.json({
      ...EXTRAS,
      metering: 'PLATFORM',
      available: 0,
      reserved: 0,
      ledger: { data: [], total: 0, page: 1, limit: 25, totalPages: 1 },
      ...over,
    }),
  );
}

describe('SmsCreditSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the unmetered mode label and no balance figures when metering is OFF', async () => {
    server.use(
      http.get('/api/v1/communications/sms-credits', () =>
        HttpResponse.json({
          ...EXTRAS,
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

    expect(await screen.findByText("School's own SMS company — no credit needed")).toBeTruthy();
    expect(screen.queryByText('Available')).toBeNull();
  });

  it('shows the platform mode label with the balance', async () => {
    server.use(
      http.get('/api/v1/communications/sms-credits', () =>
        HttpResponse.json({
          ...EXTRAS,
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

    expect(await screen.findByText('Platform credit')).toBeTruthy();
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
          ...EXTRAS,
          metering: 'OFF',
          available: 0,
          reserved: 0,
          ledger: { data: [], total: 0, page: 1, limit: 10, totalPages: 1 },
        });
      }),
      http.get(`/api/v1/platform/schools/${PICKED_SCHOOL_ID}/sms-credits`, () =>
        HttpResponse.json({
          ...EXTRAS,
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

  it('shows the reference type and never the record id in the ledger', async () => {
    server.use(
      http.get('/api/v1/communications/sms-credits', () =>
        HttpResponse.json({
          ...EXTRAS,
          metering: 'PLATFORM',
          available: 10,
          reserved: 0,
          ledger: {
            data: [
              {
                id: 'l1',
                kind: 'RESERVE',
                units: -3,
                reference_type: 'batch',
                reference_id: '11111111-2222-4333-8444-555555555555',
                reason: null,
                created_at: '2026-01-15T00:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            limit: 25,
            totalPages: 1,
          },
        }),
      ),
    );
    renderWithProviders(<SmsCreditSection schoolId={SCHOOL_ID} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect(await screen.findByText('Reminder round')).toBeTruthy();
    expect(screen.queryByText(/11111111-2222/)).toBeNull();
  });

  it('shows the packages from the server and the unmasked note', async () => {
    server.use(creditsWith({ lots: [] }));
    renderWithProviders(<SmsCreditSection schoolId={SCHOOL_ID} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });
    expect(await screen.findByText('Medium')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Buy' })).toHaveLength(3);
    expect(screen.getByText(/only sends unmasked SMS/)).toBeTruthy();
  });

  it('hides the buy parts in a SUPER_ADMIN picked-school view', async () => {
    server.use(
      http.get('/api/v1/platform/schools/school-2/sms-credits', () =>
        HttpResponse.json({
          ...EXTRAS,
          metering: 'PLATFORM',
          available: 0,
          reserved: 0,
          ledger: { data: [], total: 0, page: 1, limit: 25, totalPages: 1 },
        }),
      ),
    );
    renderWithProviders(<SmsCreditSection schoolId="school-2" isSuperAdmin />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: SCHOOL_ID,
    });
    expect(await screen.findByText('You have no SMS left.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Buy' })).toBeNull();
  });

  it('opens the buy dialog from ?smsBuy=1', async () => {
    server.use(creditsWith({}));
    renderWithProviders(<SmsCreditSection schoolId={SCHOOL_ID} smsBuy />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });
    expect(await screen.findByRole('button', { name: 'Buy with bKash' })).toBeTruthy();
  });

  it('shows the bKash return as confirming while the order is pending', async () => {
    const id = '00000000-0000-4000-8000-0000000002aa';
    server.use(
      creditsWith({
        orders: [
          {
            id,
            name: 'Medium',
            sms_count: 2000,
            price_paisa: 180000,
            status: 'PENDING_PAYMENT',
            paid_at: null,
            receipt_available: false,
          },
        ],
      }),
    );
    renderWithProviders(<SmsCreditSection schoolId={SCHOOL_ID} smsOrder={id} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });
    expect(await screen.findByText(/confirming your payment/)).toBeTruthy();
  });
});
