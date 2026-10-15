import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './homework-to-check.widget';

const URL = '/api/v1/dashboard/widgets/homework-to-check';

function renderWidget(variant: 'full' | 'compact' | 'tile', locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="M" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'TEACHER',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

const item = (extra: object) => ({
  assignment_id: 'a1',
  homework_id: 'h1',
  title: 'Chapter 3 sums',
  class_name: '7',
  section_name: 'B',
  subject_name_en: 'Mathematics',
  subject_name_bn: 'গণিত',
  due_date: '2026-10-06',
  submitted_count: 11,
  ...extra,
});
const BASE = {
  total_submitted: 18,
  assignment_count: 2,
  items: [
    item({}),
    item({ assignment_id: 'a2', homework_id: 'h2', title: 'Essay', submitted_count: 7 }),
  ],
};

describe('homework-to-check widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('homework-to-check');
  });

  it('full: headline, sentence, rows and link to the first homework', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('18')).toBeTruthy();
    expect(screen.getByText('Submissions for 2 homework are waiting for you.')).toBeTruthy();
    expect(screen.getByText('11')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See submissions' }).getAttribute('href')).toBe(
      '/academics/homework/h1',
    );
  });

  it('bn: rows use Bangla digits', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect(await screen.findByText('১১টা')).toBeTruthy();
    expect(screen.getByText('৭টা')).toBeTruthy();
  });

  it('tile: total and homework hint', async () => {
    serve(BASE);
    renderWidget('tile');
    expect(await screen.findByText('18')).toBeTruthy();
    expect(screen.getByText('in 2 homework')).toBeTruthy();
  });

  it('empty: reason and no link', async () => {
    serve({ total_submitted: 0, assignment_count: 0, items: [] });
    renderWidget('full');
    expect(await screen.findByText('Nothing to check.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
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
});
