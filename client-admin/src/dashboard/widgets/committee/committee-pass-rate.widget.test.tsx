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

import Widget, { committeePassRateTable, widgetKey } from './committee-pass-rate.widget';

// Echoes the key, so a table's cells can be compared without translation.
const tKey = ((k: string) => k) as unknown as TFunction;

const URL = '/api/v1/dashboard/widgets/committee-pass-rate';

const BASE = {
  exam_name: 'Half-yearly 2026',
  classes: [
    { class_name: '6', numeric_grade: 6, appeared: 120, pass_percentage: 94 },
    { class_name: '7', numeric_grade: 7, appeared: 118, pass_percentage: 81.5 },
    { class_name: '8', numeric_grade: 8, appeared: 110, pass_percentage: 90 },
  ],
  overall_pass_percentage: 88.5,
  recent_rounds: [
    { exam_name: 'Annual 2025', pass_percentage: 85 },
    { exam_name: 'Half-yearly 2026', pass_percentage: 88.5 },
  ],
  previous_pass_percentage: 85,
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

describe('committee-pass-rate widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('widgetKey equals the catalogue key', () => {
    expect(widgetKey).toBe(DashboardWidgetKey.COMMITTEE_PASS_RATE);
  });

  it('full: lowest class in the value and the summary, with the school average', async () => {
    serve(BASE);
    renderWidget('full');
    expect((await screen.findAllByText('81.5%')).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('In Half-yearly 2026, class 7 is 7.0% below the school average.').length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('School average 88.5%').length).toBeGreaterThan(0);
  });

  it('tile: previous null gives noPrevious', async () => {
    serve({ ...BASE, previous_pass_percentage: null });
    renderWidget('tile');
    expect(await screen.findByText('No earlier exam to compare')).toBeTruthy();
  });

  it('tile: up vs the previous exam', async () => {
    serve(BASE);
    renderWidget('tile');
    expect(await screen.findByText('3.5% higher than the previous exam')).toBeTruthy();
  });

  it('table lists every class and matches the exported helper', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findAllByText('School average 88.5%');
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(committeePassRateTable(BASE, tKey, REGION_BD_EN).rows[1]).toEqual(['7', '81.5%']);
  });

  it('empty when exam_name is null; no link', async () => {
    serve({ ...BASE, exam_name: null, classes: [], overall_pass_percentage: null });
    renderWidget('full');
    expect(await screen.findByText('No exam results published yet.')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('axe clean (full)', async () => {
    serve(BASE);
    const { container } = renderWidget('full');
    await screen.findAllByText('School average 88.5%');
    await expect(container).toHaveNoViolations();
  });
});
