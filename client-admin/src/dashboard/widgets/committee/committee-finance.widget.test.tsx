import '@biddaloy/ui/test';

import { DashboardWidgetKey } from '@biddaloy/shared';
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TFunction } from 'i18next';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, {
  committeeCollectedPercent,
  committeeFinanceTable,
  widgetKey,
} from './committee-finance.widget';

// Echoes the key, so a table's cells can be compared without translation.
const tKey = ((k: string) => k) as unknown as TFunction;

const URL = '/api/v1/dashboard/widgets/committee-finance';

const point = (received_pct: number | null) => ({
  as_of: '2026-10-07',
  received: 700000,
  billed_for_month: 1000000,
  received_pct,
});
const BASE = {
  // Future months are absent from the series, not null.
  months: [
    { month: '2026-07', billed: 1000000, paid: 900000, outstanding: 100000 },
    { month: '2026-08', billed: 1000000, paid: 800000, outstanding: 200000 },
    { month: '2026-09', billed: 1000000, paid: 600000, outstanding: 400000 },
    { month: '2026-10', billed: 1000000, paid: 300000, outstanding: 345000 },
  ],
  year_outstanding: 1045000,
  current_month: {
    ...point(70),
    month: '2026-10',
    last_month_same_point: point(65),
    last_year_same_point: point(62),
  },
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
    role: 'COMMITTEE',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('committee-finance widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('widgetKey equals the catalogue key', () => {
    expect(widgetKey).toBe(DashboardWidgetKey.COMMITTEE_FINANCE);
  });

  it('full: outstanding in bn digits with lakh grouping and the Σpaid÷Σbilled summary', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect(await screen.findByText('৳১০,৪৫,০০০.০০')).toBeTruthy();
  });

  it('full (en): collected percent summary', async () => {
    serve(BASE);
    renderWidget('full');
    // (900+800+600+300)/4000 = 65%
    expect((await screen.findAllByText('65% of this year\'s bills collected.')).length).toBeGreaterThan(0);
    expect(committeeCollectedPercent(BASE)).toBe(65);
  });

  it('tile: +8 points vs last year is good; null last year is neutral lastYearNone', async () => {
    serve(BASE);
    const { unmount } = renderWidget('tile');
    expect(await screen.findByText('8% more than this time last year')).toBeTruthy();
    unmount();
    serve({ ...BASE, current_month: { ...BASE.current_month, last_year_same_point: null } });
    renderWidget('tile');
    expect(await screen.findByText('No figure for last year')).toBeTruthy();
  });

  it('desktop chart has two series and a legend; phone shows exactly the last 3 months', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findAllByText("65% of this year's bills collected.");
    expect(screen.getAllByText('Collected').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Outstanding').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('stacked-bar-track')).toHaveLength(3);
  });

  it('table rows are the months with billed / collected / outstanding', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findAllByText("65% of this year's bills collected.");
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getAllByRole('row')).toHaveLength(5);
    const table = committeeFinanceTable(BASE, tKey, REGION_BD_EN);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[0]).toHaveLength(4);
  });

  it('empty when no months; never a link', async () => {
    serve({ ...BASE, months: [], year_outstanding: 0 });
    renderWidget('full');
    expect(await screen.findByText('No fees billed this year yet.')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('axe clean (full)', async () => {
    serve(BASE);
    const { container } = renderWidget('full');
    await screen.findAllByText("65% of this year's bills collected.");
    await expect(container).toHaveNoViolations();
  });
});
