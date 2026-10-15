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

import Widget, { committeeEnrollmentTable, widgetKey } from './committee-enrollment.widget';

// Echoes the key, so a table's cells can be compared without translation.
const tKey = ((k: string) => k) as unknown as TFunction;

const URL = '/api/v1/dashboard/widgets/committee-enrollment';

const BASE = {
  years: [
    { year_label: '2022', student_count: 1104 },
    { year_label: '2023', student_count: 1150 },
    { year_label: '2024', student_count: 1180 },
    { year_label: '2025', student_count: 1214 },
    { year_label: '2026', student_count: 1248 },
  ],
  current_count: 1248,
  previous_count: 1214,
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

describe('committee-enrollment widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('widgetKey equals the catalogue key', () => {
    expect(widgetKey).toBe(DashboardWidgetKey.COMMITTEE_ENROLLMENT);
    expect(widgetKey).toBe('committee-enrollment');
  });

  it('full: growth value and summary with both numbers', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('+13%')).toBeTruthy();
    expect(screen.getAllByText('Students grew from 1,104 to 1,248 in 4 years.').length).toBeGreaterThan(0);
  });

  it('tile: change from last year is good; previous null gives noPrevious', async () => {
    serve(BASE);
    const { unmount } = renderWidget('tile');
    expect(await screen.findByText('1,248')).toBeTruthy();
    expect(screen.getByText('34 more than last year')).toBeTruthy();
    unmount();
    serve({ ...BASE, previous_count: null });
    renderWidget('tile');
    expect(await screen.findByText('No figure for last year')).toBeTruthy();
  });

  it('table has one row per year and matches the exported helper', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('+13%');
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getAllByRole('row')).toHaveLength(6);
    const table = committeeEnrollmentTable(BASE, tKey, REGION_BD_EN);
    expect(table.rows).toHaveLength(5);
    expect(table.rows[4]).toEqual(['2026', '1,248']);
  });

  it('bn: Bangla digits', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect(await screen.findByText('+১৩%')).toBeTruthy();
  });

  it('empty when there are no years; no variant has a link; no person data rendered', async () => {
    serve({ years: [], current_count: 0, previous_count: null });
    renderWidget('full');
    expect(await screen.findByText('No academic year yet.')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('error: Retry fires a second request', async () => {
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
    await screen.findByText('+13%');
    await expect(container).toHaveNoViolations();
  });
});
