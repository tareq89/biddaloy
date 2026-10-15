import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './seat-plan-status.widget';

const URL = '/api/v1/dashboard/widgets/seat-plan-status';

const exam = (i: number, schedule: number, planned: number, published: number) => ({
  exam_id: `e-${i}`,
  exam_name: `Exam ${i}`,
  class_name: '7',
  first_date: `2026-11-0${i}`,
  schedule_count: schedule,
  planned_count: planned,
  published_count: published,
});

function renderWidget(variant: 'full' | 'compact', locale: 'en' | 'bn' = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="M" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'EXAM_CONTROLLER',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('seat-plan-status widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('seat-plan-status');
  });

  it('full: count, rows in order, three badge cases, link', async () => {
    serve({
      exams_needing_plan: 2,
      exams: [exam(1, 2, 2, 2), exam(2, 2, 1, 0), exam(3, 2, 0, 0)],
    });
    renderWidget('full');
    expect(await screen.findByText('2 exams need a seat plan')).toBeTruthy();
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(rows[0]).toContain('Exam 1, class 7');
    expect(rows[0]).toContain('Published');
    expect(rows[1]).toContain('Draft');
    expect(rows[2]).toContain('Not started');
    expect(screen.getByRole('link', { name: 'Open seat plans' }).getAttribute('href')).toBe(
      '/exams/seat-plans',
    );
    expect(screen.queryByText('e-1')).toBeNull();
  });

  it('none needing: allPlanned', async () => {
    serve({ exams_needing_plan: 0, exams: [exam(1, 1, 1, 1)] });
    renderWidget('full');
    expect(await screen.findByText('Every upcoming exam has a seat plan.')).toBeTruthy();
  });

  it('caps rows: 5 on full, 3 on compact', async () => {
    const exams = [1, 2, 3, 4, 5, 6, 7].map((i) => exam(i, 1, 0, 0));
    serve({ exams_needing_plan: 7, exams });
    const { unmount } = renderWidget('full');
    await screen.findByText('7 exams need a seat plan');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    unmount();
    renderWidget('compact');
    await userEvent.click(await screen.findByRole('button', { expanded: false }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('compact: first row is the sentence', async () => {
    serve({ exams_needing_plan: 1, exams: [exam(1, 1, 0, 0)] });
    renderWidget('compact');
    expect((await screen.findAllByText('Exam 1, class 7')).length).toBeGreaterThan(0);
  });

  it('empty: reason and /exams link', async () => {
    serve({ exams_needing_plan: 0, exams: [] });
    renderWidget('full');
    expect(await screen.findByText('No upcoming exam has a schedule yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open exams' }).getAttribute('href')).toBe('/exams');
  });

  it('error: Retry refetches', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 });
      }),
    );
    renderWidget('full');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
  });

  it('bn: Bengali digits', async () => {
    serve({ exams_needing_plan: 1, exams: [exam(1, 2, 1, 0)] });
    renderWidget('full', 'bn');
    expect(await screen.findByText(/২/)).toBeTruthy();
  });

  it('is axe clean on full', async () => {
    serve({ exams_needing_plan: 1, exams: [exam(1, 2, 1, 0)] });
    const { container } = renderWidget('full');
    await screen.findByText('1 exam needs a seat plan');
    await expect(container).toHaveNoViolations();
  });
});
