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
    today,
  };
}

function renderList() {
  renderWithRouter(routeTree, {
    initialEntries: ['/attendance'],
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
    expect(within(links[0]!).getByText('Not marked')).toBeTruthy();
    expect(within(links[0]!).getByText('40 students')).toBeTruthy();
    expect(within(links[1]!).getByText('Draft')).toBeTruthy();
    expect(within(links[2]!).getByText('Marked 32/35')).toBeTruthy();
  });

  it('says how many sections are left today', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([
          section('s-none', 'A', null),
          section('s-draft', 'B', { ...FINALIZED, state: 'DRAFT' }),
          section('s-final', 'C', FINALIZED),
        ]),
      ),
    );

    renderList();

    expect(await screen.findByText(/2 sections left/)).toBeTruthy();
    expect(screen.queryByText(/every section is submitted/)).toBeNull();
  });

  it('says every section is submitted when none is left', async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([section('s-final', 'C', FINALIZED)]),
      ),
    );

    renderList();

    expect(await screen.findByText(/every section is submitted/)).toBeTruthy();
    expect(screen.queryByText(/sections? left/)).toBeNull();
  });

  it('shows an empty state when the teacher has no mapped sections', async () => {
    server.use(http.get('/api/v1/attendance/my-sections', () => HttpResponse.json([])));

    renderList();

    expect(await screen.findByText('No sections assigned yet')).toBeTruthy();
  });
});
