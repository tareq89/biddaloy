/** [67.5.07] Alerts report hooks — query string, month gate, CSV download. */
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setActiveTenant } from '../../api/auth-state';
import { server } from '../../test/msw/server';
import { renderHookWithProviders } from '../../test/render-hook-with-providers';
import { cleanupTestState } from '../../test/render-with-providers';

import { downloadAlertsReportCsv, useAlertsReport } from './use-alerts-report';

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupTestState();
});

describe('alerts report hooks', () => {
  it('sends month, ruleKey and sectionId', async () => {
    let params: URLSearchParams | null = null;
    server.use(
      http.get('*/attention/report', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({ month: '2026-10', facts: {}, sections: [], rows: [] });
      }),
    );
    const { result } = renderHookWithProviders(
      () =>
        useAlertsReport({ month: '2026-10', ruleKey: 'attendance.not_taken', sectionId: 's-1' }),
      { tenantId: 'tenant-1' },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Object.fromEntries(params!.entries())).toEqual({
      month: '2026-10',
      ruleKey: 'attendance.not_taken',
      sectionId: 's-1',
      format: 'json',
    });
  });

  it('is disabled without a month', () => {
    const { result } = renderHookWithProviders(() => useAlertsReport({ month: '' }), {
      tenantId: 'tenant-1',
    });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('CSV download requests format=csv and clicks an anchor with the file name', async () => {
    let format: string | null = null;
    server.use(
      http.get('*/attention/report', ({ request }) => {
        format = new URL(request.url).searchParams.get('format');
        return new HttpResponse('a,b', { headers: { 'Content-Type': 'text/csv' } });
      }),
    );
    setActiveTenant('tenant-1');
    let name = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      name = this.download;
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => undefined;
    try {
      await downloadAlertsReportCsv({ month: '2026-10' });
    } finally {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
    expect(format).toBe('csv');
    expect(name).toBe('alerts-report-2026-10.csv');
  });
});
