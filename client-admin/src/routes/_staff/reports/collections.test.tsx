import { toast } from '@biddaloy/ui/components';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatDate, formatServerAmount } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { resolvePresetRange } from './collections';

/** [16.6.4]'s `/reports/collections` — real route tree, same pattern
 * `attendance/reports.test.tsx` documents for itself. */
describe('/reports/collections', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function reportResponse(overrides: Record<string, unknown> = {}) {
    return {
      range: { from: '2026-09-01', to: '2026-09-16' },
      totals: {
        collected: 5000,
        reversed: 100,
        net: 4900,
        standing_discount: 1666.67,
        one_off_discount: 50,
        wallet_used: 30,
        wallet_added: 10,
        change_returned: 5,
      },
      by_method: [{ payment_method: 'CASH', count: 12, collected: 3000, reversed: 0, net: 3000 }],
      by_collector: [
        {
          user_id: 'user-1',
          full_name: 'Karim Rahman',
          count: 12,
          collected: 3000,
          reversed: 0,
          net: 3000,
        },
      ],
      by_fee_type: [{ fee_type: 'MONTHLY_TUITION', collected: 4000, discount: 166.67 }],
      by_day: [{ date: '2026-09-15', collected: 1000, reversed: 0, net: 1000 }],
      ...overrides,
    };
  }

  function renderReport(entry = '/reports/collections') {
    renderWithRouter(routeTree, {
      initialEntries: [entry],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
  }

  it('renders with a payment present', async () => {
    server.use(http.get('/api/v1/reports/collections', () => HttpResponse.json(reportResponse())));
    renderReport();

    await screen.findAllByText('Karim Rahman');
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
    expect(screen.getByText('Cash')).toBeTruthy();
    expect(screen.getByText('Monthly tuition')).toBeTruthy();
    // The app's default region is Bangla even with the `en` UI text, so amounts and dates use it.
    expect(screen.getByText(formatServerAmount(4900, REGION_BD_BN))).toBeTruthy();
    expect(screen.getByText(formatDate('2026-09-15', REGION_BD_BN))).toBeTruthy();
    expect(screen.getAllByText(/^Total [0-9০-৯]+$/)).toHaveLength(4);
  });

  it('shows the error state with a retry when the report fails to load', async () => {
    server.use(
      http.get('/api/v1/reports/collections', () => HttpResponse.json({}, { status: 500 })),
    );
    renderReport();

    await waitFor(() =>
      expect(screen.getByText('Could not load the collections report.')).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('drops an invalid collector id from the URL instead of sending it', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/reports/collections', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json(reportResponse());
      }),
    );
    renderReport('/reports/collections?received_by_user_id=not-a-uuid');
    await waitFor(() => expect(params).toBeDefined());
    expect(params?.has('received_by_user_id')).toBe(false);
  });

  it('sends the server filter names to the report', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/reports/collections', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json(reportResponse());
      }),
    );
    renderReport(
      '/reports/collections?payment_method=CASH&received_by_user_id=11111111-1111-4111-8111-111111111111',
    );

    await waitFor(() => expect(params).toBeDefined());
    expect(params?.get('payment_method')).toBe('CASH');
    expect(params?.get('received_by_user_id')).toBe('11111111-1111-4111-8111-111111111111');
    expect(params?.has('method')).toBe(false);
    expect(params?.has('collector_id')).toBe(false);
  });

  it('sends the current method/collector filters on CSV download and shows an error toast when it fails', async () => {
    let csvParams: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/reports/collections', () => HttpResponse.json(reportResponse())),
      http.get('/api/v1/reports/collections.csv', ({ request }) => {
        csvParams = new URL(request.url).searchParams;
        return HttpResponse.json({ message: 'boom' }, { status: 500 });
      }),
    );
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');

    try {
      renderWithRouter(routeTree, {
        initialEntries: [
          '/reports/collections?payment_method=CASH&received_by_user_id=11111111-1111-4111-8111-111111111111&preset=custom&from=2026-09-01&to=2026-09-16',
        ],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Download CSV' }));

      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith('Could not download the CSV. Please try again.'),
      );
      expect(csvParams?.get('payment_method')).toBe('CASH');
      expect(csvParams?.get('received_by_user_id')).toBe('11111111-1111-4111-8111-111111111111');
    } finally {
      toastSpy.mockRestore();
    }
  });
});

describe('resolvePresetRange', () => {
  // Wednesday 2026-09-16 12:00 UTC == 18:00 Asia/Dhaka same calendar day.
  const now = new Date('2026-09-16T12:00:00Z');

  it('resolves "today" to the current Dhaka calendar day', () => {
    expect(resolvePresetRange('today', now)).toEqual({ from: '2026-09-16', to: '2026-09-16' });
  });

  it('resolves "yesterday" to the previous Dhaka calendar day', () => {
    expect(resolvePresetRange('yesterday', now)).toEqual({
      from: '2026-09-15',
      to: '2026-09-15',
    });
  });

  it('resolves "week" to Monday through today', () => {
    // 2026-09-16 is a Wednesday, so Monday is 2026-09-14.
    expect(resolvePresetRange('week', now)).toEqual({ from: '2026-09-14', to: '2026-09-16' });
  });

  it('resolves "month" to the 1st through today', () => {
    expect(resolvePresetRange('month', now)).toEqual({ from: '2026-09-01', to: '2026-09-16' });
  });

  it('resolves "today" across a Dhaka calendar-day boundary that UTC hasn\'t crossed yet', () => {
    // The real UTC instant 2026-09-16T20:00:00Z is 2026-09-17 02:00 in
    // Asia/Dhaka (UTC+6) — the UTC calendar day is still the 16th, but
    // Dhaka's is already the 17th. `resolvePresetRange`'s `now` parameter
    // is always the already-Dhaka-shifted value `dhakaNow()` produces (the
    // shift happens once, at the call site — see the module's own "shift,
    // then read UTC fields" convention), so this passes that shifted
    // instant directly, the same way `dhakaNow()` would compute it.
    const utcInstant = Date.parse('2026-09-16T20:00:00Z');
    const dhakaShifted = new Date(utcInstant + 6 * 60 * 60_000);
    expect(resolvePresetRange('today', dhakaShifted)).toEqual({
      from: '2026-09-17',
      to: '2026-09-17',
    });
  });
});
