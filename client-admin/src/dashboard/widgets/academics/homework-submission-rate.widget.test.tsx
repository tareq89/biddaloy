import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './homework-submission-rate.widget';

const URL = '/api/v1/dashboard/widgets/homework-submission-rate';

const cls = (id: string, name: string, submitted: number, assigned: number) => ({
  class_id: id,
  class_name: name,
  submitted,
  assigned,
  percentage: Math.round((submitted / assigned) * 100),
});

const BASE = {
  window: { from: '2026-10-01', to: '2026-10-07' },
  overall: { submitted: 45, assigned: 60, percentage: 75 },
  classes: [cls('c6', '6', 25, 30), cls('c8', '8', 8, 20), cls('c9', '9', 10, 10)],
};

function renderWidget(variant: 'full' | 'compact', locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="S" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'EXECUTIVE',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('homework-submission-rate widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('widgetKey', () => {
    expect(widgetKey).toBe('homework-submission-rate');
  });

  it('full: 45 of 60 → 75%, lowest class, one bar per class, link', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('75%')).toBeTruthy();
    expect(screen.getByText(/45 of 60 expected submissions came in\./)).toBeTruthy();
    expect(screen.getByText(/Lowest: class 8 \(40%\)\./)).toBeTruthy();
    expect(screen.getAllByRole('progressbar')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'See homework' }).getAttribute('href')).toBe(
      '/academics/homework',
    );
  });

  it('table toggle lists a row per class', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('75%');
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('compact: percentage and sentence, no bars', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('75%')).toBeTruthy();
    expect(screen.getByText(/45 of 60 expected/)).toBeTruthy();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('nothing due → emptyReason', async () => {
    serve({ ...BASE, overall: { submitted: 0, assigned: 0, percentage: 0 }, classes: [] });
    renderWidget('full');
    expect(await screen.findByText('No homework was due in the last 7 days.')).toBeTruthy();
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
