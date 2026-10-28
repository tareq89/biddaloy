import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Widget, { widgetKey } from './collection-by-month.widget';

const URL = '/api/v1/dashboard/widgets/collection-by-month';

// Ten finished months, October running, November/December not yet.
const NETS = [90000, 85000, 120000, 100000, 95000, 110000, 70000, 60000, 130000];
const BASE = {
  year: 2026,
  year_to_date_net: 1000000,
  month_to_date_net: 48500,
  previous_month_same_days_net: 41200,
  months: Array.from({ length: 12 }, (_, i) => ({
    year: 2026,
    month: i + 1,
    net: i < 9 ? NETS[i]! : i === 9 ? 48500 : null,
    is_current: i === 9,
  })),
};

function renderWidget(variant: 'full' | 'compact' | 'tile', locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="M" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'ACCOUNTANT',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('collection-by-month widget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T06:00:00Z'));
  });
  afterEach(async () => {
    vi.useRealTimers();
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('collection-by-month');
  });

  it('full: sentence, only the current segment is dashed, peak labelled, link', async () => {
    serve(BASE);
    renderWidget('full');
    expect(
      await screen.findByText(
        '৳48,500.00 in the first 7 days of October — ৳7,300.00 more than the same days of September.',
      ),
    ).toBeTruthy();
    const paths = document.querySelectorAll('path[data-series]');
    expect(paths).toHaveLength(2);
    expect(paths[0]!.getAttribute('stroke-dasharray')).toBeNull();
    expect(paths[1]!.getAttribute('stroke-dasharray')).toBeTruthy();
    // null months (Nov, Dec) are not plotted
    expect(document.querySelectorAll('circle').length).toBeLessThanOrEqual(10);
    expect(screen.getByText('৳1,30,000.00, September 2026')).toBeTruthy();
    expect(screen.getByText('Finished month')).toBeTruthy();
    expect(screen.getByText('This month, still running')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open collections report' }).getAttribute('href')).toBe(
      '/reports/collections',
    );
  });

  it('table rows use formatMonth and show — for future months', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText(/more than the same days/);
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getAllByRole('row')).toHaveLength(13);
    expect(screen.getByText('January 2026')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBe(2);
  });

  it('July-June year labels the first row July 2026 and the last June 2027', async () => {
    serve({
      ...BASE,
      months: Array.from({ length: 12 }, (_, i) => ({
        year: i < 6 ? 2026 : 2027,
        month: ((i + 6) % 12) + 1,
        net: i < 3 ? 1000 : i === 3 ? 500 : null,
        is_current: i === 3,
      })),
    });
    renderWidget('full');
    await screen.findByText(/more than the same days|less than the same days/);
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getByText('July 2026')).toBeTruthy();
    expect(screen.getByText('June 2027')).toBeTruthy();
  });

  it('negative diff -> vsLastMonthLess', async () => {
    serve({ ...BASE, month_to_date_net: 30000 });
    renderWidget('full');
    expect(await screen.findByText(/৳11,200.00 less than the same days of September/)).toBeTruthy();
  });

  it('compact: year to date in the header, sparkline in the body', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('৳10,00,000.00')).toBeTruthy();
    expect(screen.getByText('this academic year so far')).toBeTruthy();
  });

  it('empty year -> emptyReason', async () => {
    serve({
      ...BASE,
      year_to_date_net: 0,
      month_to_date_net: 0,
      previous_month_same_days_net: 0,
      months: BASE.months.map((m) => ({ ...m, net: m.net === null ? null : 0 })),
    });
    renderWidget('full');
    expect(await screen.findByText('Nothing collected this academic year yet.')).toBeTruthy();
  });

  it('error: Retry fires a second request', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json(
          { statusCode: 404, message: 'x', timestamp: '', path: '', requestId: '' },
          { status: 404 },
        );
      }),
    );
    renderWidget('full');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls).toBe(2));
  });
});
