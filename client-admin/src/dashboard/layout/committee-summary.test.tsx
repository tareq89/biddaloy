import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { CommitteeSummary } from './committee-summary';

const point = (received_pct: number) => ({
  as_of: '2026-10-07',
  received: 1,
  billed_for_month: 1,
  received_pct,
});

function serve(attendanceBody: object, financeStatus?: number) {
  server.use(
    http.get('/api/v1/dashboard/widgets/committee-attendance', () =>
      HttpResponse.json(attendanceBody),
    ),
    http.get('/api/v1/dashboard/widgets/committee-finance', () =>
      financeStatus
        ? HttpResponse.json({ message: 'x' }, { status: financeStatus })
        : HttpResponse.json({
            months: [],
            year_outstanding: 0,
            current_month: {
              ...point(70),
              month: '2026-10',
              last_month_same_point: null,
              last_year_same_point: point(62),
            },
          }),
    ),
  );
}

function renderSummary() {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: CommitteeSummary,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale: 'en',
    role: 'COMMITTEE',
    tenantId: 'tenant-1',
  });
}

const NEAR = {
  months: [{ month: '2026-10', percentage: 89 }],
  current_month_percentage: 89,
  year_percentage: 88,
  target_percentage: 90,
};

describe('CommitteeSummary', () => {
  afterEach(cleanupTestState);

  it('near target + ahead: a region named by the sentence, caption, no button', async () => {
    serve(NEAR);
    const { container } = renderSummary();
    const region = await screen.findByRole('region', {
      name: 'Attendance is close to its target — collection is 8% ahead of this time last year.',
    });
    expect(region.textContent).toContain('Updated just now');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    await expect(container).toHaveNoViolations();
  });

  it('loading is aria-busy', async () => {
    serve(NEAR);
    const { container } = renderSummary();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeTruthy());
  });
});
