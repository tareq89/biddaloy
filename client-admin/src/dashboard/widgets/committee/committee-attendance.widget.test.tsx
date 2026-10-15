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

import Widget, { committeeAttendanceTable, widgetKey } from './committee-attendance.widget';

// Echoes the key, so a table's cells can be compared without translation.
const tKey = ((k: string) => k) as unknown as TFunction;

const URL = '/api/v1/dashboard/widgets/committee-attendance';

const BASE = {
  months: [
    { month: '2026-07', percentage: 91 },
    { month: '2026-08', percentage: null },
    { month: '2026-09', percentage: 86.5 },
    { month: '2026-10', percentage: 89 },
  ],
  current_month_percentage: 89,
  year_percentage: 88.1,
  target_percentage: 90,
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

describe('committee-attendance widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('widgetKey equals the catalogue key', () => {
    expect(widgetKey).toBe(DashboardWidgetKey.COMMITTEE_ATTENDANCE);
  });

  it('full: year value, lowest-month summary, target line label', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('88.1%')).toBeTruthy();
    expect(screen.getAllByText('Lowest in September at 86.5%; now 89.0%.').length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText('Target 90.0%').length).toBeGreaterThan(0);
  });

  it('tile: below target shows the gap, at or above shows targetMet', async () => {
    serve(BASE);
    const { unmount } = renderWidget('tile');
    expect(await screen.findByText('Target 90.0%, 1.0% away')).toBeTruthy();
    unmount();
    serve({ ...BASE, current_month_percentage: 91 });
    renderWidget('tile');
    expect(await screen.findByText('Target 90.0% reached')).toBeTruthy();
  });

  it('a null month is "No register" in the table and not drawn', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('88.1%');
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getByText('No register')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(5);
    const rows = committeeAttendanceTable(BASE, tKey, REGION_BD_EN).rows;
    expect(rows[1]?.[1]).toBe('widgets.committee-attendance.noRegister');
  });

  it('empty when every month is null; no link', async () => {
    serve({ ...BASE, months: [{ month: '2026-10', percentage: null }], year_percentage: null });
    renderWidget('full');
    expect(await screen.findByText('No attendance taken this year yet.')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('error: Try again fires a second request', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json({ message: 'x' }, { status: 500 });
      }),
    );
    renderWidget('full');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'Try again' });
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('axe clean (full)', async () => {
    serve(BASE);
    const { container } = renderWidget('full');
    await screen.findByText('88.1%');
    await expect(container).toHaveNoViolations();
  });
});
