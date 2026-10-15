import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './my-lessons-to-mark.widget';

const URL = '/api/v1/dashboard/widgets/my-lessons-to-mark';

const row = (planned_on: string, lesson_title: string | null) => ({
  class_name: '7',
  section_name: 'B',
  subject_name_en: 'Mathematics',
  subject_name_bn: 'গণিত',
  planned_on,
  lesson_title,
});
const BASE = {
  to_mark: 3,
  oldest_planned_on: '2026-10-05',
  items: [
    row('2026-10-07', 'Exercise 5.3'),
    row('2026-10-06', null),
    row('2026-10-05', 'Exercise 5.2'),
  ],
};

function renderWidget(variant: 'full' | 'compact' | 'tile', locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="S" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'TEACHER',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('my-lessons-to-mark widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('my-lessons-to-mark');
  });

  it('full: the count, the rows, and ONE primary link to the marking page at the oldest day', async () => {
    serve(BASE);
    renderWidget('full');
    const link = await screen.findByRole('link', { name: 'Mark lessons' });
    expect(link.getAttribute('href')).toMatch(/^\/routines\/my\?date=2026-10-05$/);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText(/Exercise 5\.3/)).toBeTruthy();
    expect(screen.getAllByText(/7 B · Mathematics/)).toHaveLength(3);
  });

  it('bn: Bangla subject name', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect((await screen.findAllByText(/গণিত/)).length).toBe(3);
  });

  it('zero: all marked, no button', async () => {
    serve({ to_mark: 0, oldest_planned_on: null, items: [] });
    renderWidget('full');
    expect(await screen.findByText('All your lessons are marked.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('compact: title and count in the header, no row list', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('Lessons to mark')).toBeTruthy();
    expect(await screen.findByText('3')).toBeTruthy();
    expect(screen.queryByText(/Exercise 5\.3/)).toBeNull();
  });

  it('tile: count and the "since" note', async () => {
    serve(BASE);
    renderWidget('tile');
    expect(await screen.findByText('3')).toBeTruthy();
    expect(screen.getByText('Lessons to mark')).toBeTruthy();
    expect(screen.getByText(/^Since /)).toBeTruthy();
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

  it('is axe clean on full', async () => {
    serve(BASE);
    const { container } = renderWidget('full');
    await screen.findByRole('link', { name: 'Mark lessons' });
    await expect(container).toHaveNoViolations();
  });
});
