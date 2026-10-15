import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './class-teacher-streaks.widget';

const URL = '/api/v1/dashboard/widgets/class-teacher-streaks';

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

const stu = (id: string, name: string, roll: number, length: number) => ({
  student_id: id,
  student_name: name,
  roll_number: roll,
  length,
  since_date: '2026-09-30',
});
const BASE = {
  section: { section_id: 'sec1', class_name: '7', section_name: 'B' },
  as_of_date: '2026-10-06',
  total: 3,
  items: [
    stu('1', 'Rafi Ahmed', 4, 6),
    stu('2', 'Tania Akter', 9, 4),
    stu('3', 'Sumon Das', 12, 3),
  ],
};

describe('class-teacher-streaks widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('class-teacher-streaks');
  });

  it('full: 6 is danger, 4 and 3 are warning; footer link to the section', async () => {
    serve(BASE);
    renderWidget('full');
    const six = await screen.findByText('6 days');
    expect(six.closest('[data-slot="status-badge"]')?.getAttribute('data-tone')).toBe('danger');
    expect(
      screen.getByText('4 days').closest('[data-slot="status-badge"]')?.getAttribute('data-tone'),
    ).toBe('warning');
    expect(
      screen.getByText('3 days').closest('[data-slot="status-badge"]')?.getAttribute('data-tone'),
    ).toBe('warning');
    expect(
      screen.getByText(
        'Rafi Ahmed has been absent for 6 days — better talk to the guardian today.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Full attendance of 7 B' }).getAttribute('href')).toBe(
      '/my-class/sec1',
    );
    expect(screen.getAllByRole('link', { name: 'Tell guardian' })).toHaveLength(3);
  });

  it('compact: total 3 and the longest-streak sentence', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('3')).toBeTruthy();
    expect(screen.getByText(/Rafi Ahmed has been absent for 6 days/)).toBeTruthy();
  });

  it('section null: notClassTeacher', async () => {
    serve({ section: null, as_of_date: null, total: 0, items: [] });
    renderWidget('full');
    expect(await screen.findByText('You are not a class teacher this year.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('class teacher with no streak: emptyReason', async () => {
    serve({ ...BASE, total: 0, items: [] });
    renderWidget('full');
    expect(await screen.findByText('Nobody is absent in a row.')).toBeTruthy();
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
