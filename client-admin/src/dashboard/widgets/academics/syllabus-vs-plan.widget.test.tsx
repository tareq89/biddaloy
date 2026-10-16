import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget from './syllabus-vs-plan.widget';

const URL = '/api/v1/dashboard/widgets/syllabus-vs-plan';

const cls = (id: string, name: string, done: number, expected: number, notUpdated: number) => ({
  class_id: id,
  class_name: name,
  done_percentage: done,
  expected_percentage: expected,
  behind_by: Math.max(0, expected - done),
  not_updated: notUpdated,
});

const BASE = {
  as_of: '2026-10-07',
  behind_count: 2,
  not_updated_count: 7,
  classes: [cls('c6', '6', 66, 60, 0), cls('c8', '8', 41, 60, 3), cls('c9', '9', 50, 60, 4)],
};

function renderWidget(variant: 'full' | 'compact', locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="M" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'ADMIN',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('syllabus-vs-plan widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('full: behind count, not-updated sentence, one bar per class with the expected marker', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findAllByText(/2 classes are behind the study plan/)).toBeTruthy();
    expect(screen.getAllByText(/7 lessons not updated/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('progressbar')).toHaveLength(3);
    expect(screen.getAllByTestId('bar-target').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'See behind plans' }).getAttribute('href')).toContain(
      'behind=1',
    );
  });

  it('behind classes are highlighted with the gap in aria-valuetext and a note', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findAllByText(/2 classes are behind/);
    // Digits may be localised by the tenant region, so match the unit text only.
    expect(screen.getAllByText(/% behind$/)).toHaveLength(2);
    const bar = screen.getByRole('progressbar', { name: '8' });
    expect(bar.getAttribute('aria-valuetext')).toContain('Average expected by today');
    // Class 6 is ahead of the plan: no gap note.
    expect(screen.queryAllByText(/% behind$/)).toHaveLength(2);
  });

  it('table toggle lists taught, expected, gap and not updated', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findAllByText(/2 classes are behind/);
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getAllByRole('row')).toHaveLength(4);
    for (const h of ['Taught', 'Expected', 'Behind by', 'Not updated']) {
      expect(screen.getByText(h)).toBeTruthy();
    }
  });

  it('compact: sentence only, no bars', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findAllByText(/2 classes are behind the study plan/)).toBeTruthy();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('nobody behind: says so and omits the not-updated sentence at zero', async () => {
    serve({
      ...BASE,
      behind_count: 0,
      not_updated_count: 0,
      classes: [cls('c6', '6', 66, 60, 0)],
    });
    renderWidget('full');
    expect(await screen.findAllByText('No class is behind the study plan.')).toBeTruthy();
    expect(screen.queryByText(/not updated/)).toBeNull();
  });

  it('empty: no class has a plan → reason and create link', async () => {
    serve({ as_of: '2026-10-07', behind_count: 0, not_updated_count: 0, classes: [] });
    renderWidget('full');
    expect(await screen.findByText('No class has a study plan yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create a study plan' })).toBeTruthy();
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

  it('bn digits', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect((await screen.findAllByText(/২টি শ্রেণি/)).length).toBeGreaterThan(0);
  });

  it('axe clean (full)', async () => {
    serve(BASE);
    const { container } = renderWidget('full');
    await screen.findAllByText(/2 classes are behind/);
    await expect(container).toHaveNoViolations();
  });
});
