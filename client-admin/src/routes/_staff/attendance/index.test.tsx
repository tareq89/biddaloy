import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

function todayLocalIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const FINALIZED = {
  state: 'FINALIZED',
  present: 30,
  absent: 3,
  late: 2,
  leave: 0,
  unmarked: 0,
  marked_at: '2026-09-04T00:00:00.000Z',
};

function section(id: string, name: string, today: unknown, count = 40) {
  return {
    section_id: id,
    section_name: name,
    class_name: 'Class 5',
    student_count: count,
    class_teacher_name: null,
    is_working_day: true,
    today,
  };
}

function renderList(search = '') {
  return renderWithRouter(routeTree, {
    initialEntries: [`/attendance${search}`],
    tenantId: 'tenant-1',
    role: 'TEACHER',
    locale: 'en',
  });
}

describe('/attendance', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists unfinished sections first (none, draft, finalized), each a link card with a status badge', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([
          section('s-final', 'C', FINALIZED, 35),
          section('s-none', 'A', null),
          section('s-draft', 'B', { ...FINALIZED, state: 'DRAFT' }),
        ]),
      ),
    );

    renderList();

    const links = await screen.findAllByRole('link', { name: /Class 5/ });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      `/attendance/s-none?date=${todayLocalIso()}`,
      `/attendance/s-draft?date=${todayLocalIso()}`,
      `/attendance/s-final?date=${todayLocalIso()}`,
    ]);
    expect(within(links[0]!).getByText('Class 5 – A')).toBeTruthy();
    expect(within(links[0]!).getByText('Not started')).toBeTruthy();
    expect(within(links[0]!).getByText('40 students')).toBeTruthy();
    expect(within(links[1]!).getByText('Draft')).toBeTruthy();
    expect(within(links[2]!).getByText('Finalized')).toBeTruthy();
  });

  const mixed = [
    section('s-none', 'A', null),
    section('s-draft', 'B', { ...FINALIZED, state: 'DRAFT' }),
    section('s-final', 'C', FINALIZED),
    section('s-empty', 'D', null, 0),
  ];

  it('says how many sections are pending, leaving out zero-student sections', async () => {
    server.use(http.get('/api/v1/attendance/my-sections', () => HttpResponse.json(mixed)));

    renderList();

    expect(await screen.findByText('2 of 3 sections pending')).toBeTruthy();
    expect(screen.queryByText('Class 5 – D')).toBeNull();
  });

  it('?status=pending shows only not-started and draft sections', async () => {
    server.use(http.get('/api/v1/attendance/my-sections', () => HttpResponse.json(mixed)));

    renderList('?status=pending');

    expect(await screen.findByText('Class 5 – A')).toBeTruthy();
    expect(screen.getByText('Class 5 – B')).toBeTruthy();
    expect(screen.queryByText('Class 5 – C')).toBeNull();
  });

  it('?status=done shows only finalized sections', async () => {
    server.use(http.get('/api/v1/attendance/my-sections', () => HttpResponse.json(mixed)));

    renderList('?status=done');

    expect(await screen.findByText('Class 5 – C')).toBeTruthy();
    expect(screen.queryByText('Class 5 – A')).toBeNull();
  });

  it('shows the class teacher, or "Not assigned"', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([
          { ...section('s-a', 'A', null), class_teacher_name: 'Rahim Uddin' },
          section('s-b', 'B', null),
        ]),
      ),
    );

    renderList();

    expect(await screen.findByText('Class teacher: Rahim Uddin')).toBeTruthy();
    expect(screen.getByText('Class teacher: Not assigned')).toBeTruthy();
  });

  it('shows the holiday state when no section has a working day', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([{ ...section('s-a', 'A', null), is_working_day: false }]),
      ),
    );

    renderList();

    expect(await screen.findByText('School is closed on this day')).toBeTruthy();
    expect(screen.queryByText('Class 5 – A')).toBeNull();
  });

  it('shows the all-done state when pending is chosen and nothing is pending', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([section('s-final', 'C', FINALIZED)]),
      ),
    );

    renderList('?status=pending');

    expect(await screen.findByText('All sections are marked')).toBeTruthy();
  });

  it('the all-done state for a past ?date= does not say "Today"', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([section('s-final', 'C', FINALIZED)]),
      ),
    );

    renderList('?status=pending&date=2026-09-04');

    expect(await screen.findByText('All sections are marked')).toBeTruthy();
    expect(screen.queryByText(/Today/)).toBeNull();
  });

  it('passes a chosen date to the API and to each row link', async () => {
    let requested: string | null = null;
    server.use(
      http.get('/api/v1/attendance/my-sections', ({ request }) => {
        requested = new URL(request.url).searchParams.get('date');
        return HttpResponse.json([section('s-none', 'A', null)]);
      }),
    );

    renderList('?date=2026-09-04');

    const link = await screen.findByRole('link', { name: /Class 5/ });
    expect(link.getAttribute('href')).toBe('/attendance/s-none?date=2026-09-04');
    expect(requested).toBe('2026-09-04');
  });

  it('a Bengali-numeral date in the URL is ignored, not sent (ASCII only, #626)', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([section('s-none', 'A', null)]),
      ),
    );

    renderList('?date=২০২৬-০৯-০৪');

    const link = await screen.findByRole('link', { name: /Class 5/ });
    expect(link.getAttribute('href')).toBe(`/attendance/s-none?date=${todayLocalIso()}`);
  });

  it('shows an empty state when the teacher has no mapped sections', async () => {
    server.use(http.get('/api/v1/attendance/my-sections', () => HttpResponse.json([])));

    renderList();

    expect(await screen.findByText('No sections assigned yet')).toBeTruthy();
  });
});
