/** [67.5.06] Alerts report: facts, table columns, filters on the wire, CSV, empty and error states. */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AlertsReportView } from './alerts-report-view';

/** The test tenant may render Bangla digits: accept either for every digit. */
const BN = '০১২৩৪৫৬৭৮৯';
const digits = (text: string) =>
  new RegExp(`^${text.replace(/\d/g, (d) => `[${d}${BN[Number(d)]}]`)}$`);

const SECTIONS = [
  { id: 'sec-a', label: 'Class 7 – A' },
  { id: 'sec-b', label: 'Class 7 – B' },
];

function report(over: Record<string, unknown> = {}) {
  return {
    month: '2026-10',
    facts: {
      total: 148,
      resolved: 121,
      avgResolveMinutes: 38,
      open: 27,
      openCritical: 9,
      previousMonthTotal: 160,
    },
    sections: SECTIONS,
    rows: [
      {
        ruleKey: 'attendance.not_taken',
        category: 'ATTENDANCE',
        severity: 'WARNING',
        cells: [
          { sectionId: 'sec-a', count: 5 },
          { sectionId: 'sec-b', count: 0 },
          { sectionId: null, count: 0 },
        ],
        total: 5,
      },
    ],
    ...over,
  };
}

function renderView(path = '/') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: AlertsReportView,
  });
  return renderWithRouter(root.addChildren([index]), {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

function reportHandler(seen: URLSearchParams[], body: unknown = report()) {
  return http.get('*/attention/report', ({ request }) => {
    seen.push(new URL(request.url).searchParams);
    return HttpResponse.json(body as Record<string, unknown>);
  });
}

describe('AlertsReportView', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('shows the four facts, a column per section, and no footer row', async () => {
    server.use(reportHandler([]));
    renderView();

    expect(await screen.findByText(digits('148'))).toBeTruthy();
    expect(screen.getByText(digits('121'))).toBeTruthy();
    expect(screen.getByText(digits('38 min'))).toBeTruthy();
    expect(screen.getByText(digits('27'))).toBeTruthy();
    expect(screen.getByText(digits('9 urgent'))).toBeTruthy();

    const table = await screen.findByRole('table');
    for (const section of SECTIONS) {
      expect(within(table).getByRole('columnheader', { name: section.label })).toBeTruthy();
    }
    expect(within(table).getByRole('columnheader', { name: 'Total' })).toBeTruthy();
    // No "No section" column when no row has a null-section count, and no summed footer row.
    expect(within(table).queryByRole('columnheader', { name: 'No section' })).toBeNull();
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });

  it('lists only non-zero section counts under the rule name for the phone card', async () => {
    server.use(reportHandler([]));
    renderView();
    expect(await screen.findByText(digits('Class 7 – A: 5'))).toBeTruthy();
    expect(screen.queryByText(/Class 7 – B: /)).toBeNull();
  });

  it('re-requests with the chosen month, rule and section', async () => {
    const seen: URLSearchParams[] = [];
    server.use(reportHandler(seen));
    renderView('/?rule=attendance.not_taken&section_id=sec-b&month=2026-09');

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    const last = seen.at(-1)!;
    expect(last.get('month')).toBe('2026-09');
    expect(last.get('ruleKey')).toBe('attendance.not_taken');
    expect(last.get('sectionId')).toBe('sec-b');
    expect(last.get('format')).toBe('json');
  });

  it('downloads the CSV with format=csv', async () => {
    const user = userEvent.setup();
    const seen: URLSearchParams[] = [];
    server.use(
      http.get('*/attention/report', ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.push(params);
        return params.get('format') === 'csv'
          ? new HttpResponse('a,b', { headers: { 'Content-Type': 'text/csv' } })
          : HttpResponse.json(report());
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => undefined;
    try {
      renderView();
      await screen.findByText(digits('148'));
      await user.click(screen.getByRole('button', { name: 'Download CSV' }));
      await waitFor(() => expect(seen.some((p) => p.get('format') === 'csv')).toBe(true));
    } finally {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
  });

  it('shows an empty state for a month with no alerts', async () => {
    server.use(
      reportHandler([], report({ rows: [], facts: { ...report().facts, total: 0, open: 0 } })),
    );
    renderView();
    expect(await screen.findByText(/^No alerts in /)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows an error state whose Retry refetches', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get('*/attention/report', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(
              {
                statusCode: 400,
                message: 'bad',
                timestamp: '2026-10-10T00:00:00.000Z',
                path: '/api/v1/attention/report',
                requestId: 'r-1',
              },
              { status: 400 },
            )
          : HttpResponse.json(report());
      }),
    );
    renderView();
    await user.click(await screen.findByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByText(digits('148'))).toBeTruthy();
    expect(calls).toBe(2);
  });
});
