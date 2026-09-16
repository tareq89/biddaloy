import { toast } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
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
        collected: 500000,
        reversed: 10000,
        net: 490000,
        standing_discount: 20000,
        one_off_discount: 5000,
        wallet_used: 3000,
        wallet_added: 1000,
        change_returned: 500,
      },
      by_method: [{ method: 'CASH', amount: 300000, count: 12 }],
      by_collector: [{ collector_id: 'user-1', collector_name: 'Karim Rahman', amount: 300000, count: 12 }],
      by_fee_type: [{ fee_type: 'Tuition', amount: 400000, count: 10 }],
      by_day: [{ date: '2026-09-15', amount: 100000 }],
      ...overrides,
    };
  }

  it('renders totals tiles and the breakdown tables from the report response', async () => {
    server.use(
      http.get('/api/v1/reports/collections', () => HttpResponse.json(reportResponse())),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/reports/collections'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Karim Rahman');
    expect(screen.getByText('Tuition')).toBeTruthy();
  });

  it('shows the error message when the report fails to load', async () => {
    server.use(
      http.get('/api/v1/reports/collections', () => HttpResponse.json({}, { status: 500 })),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/reports/collections'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByText('Could not load the collections report.')).toBeTruthy(),
    );
  });

  it('renders an empty by-day chart message when there is no data', async () => {
    server.use(
      http.get('/api/v1/reports/collections', () =>
        HttpResponse.json(reportResponse({ by_day: [] })),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/reports/collections'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('No collections in this range.');
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
          '/reports/collections?method=CASH&collector_id=user-1&preset=custom&from=2026-09-01&to=2026-09-16',
        ],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Download CSV' }));

      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith(
          'Could not download the CSV. Please try again.',
        ),
      );
      expect(csvParams?.get('method')).toBe('CASH');
      expect(csvParams?.get('collector_id')).toBe('user-1');
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
