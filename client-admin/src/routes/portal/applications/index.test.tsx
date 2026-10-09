import {
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';
import { applicationDto } from '../../_staff/applications/-detail/-application-fixture';

/** A JWT whose `sub` is "u-me", so "you submitted this" can be told from someone else. */
const TOKEN = `x.${btoa(JSON.stringify({ sub: 'u-me', exp: 4_000_000_000 }))}.y`;

const child = (name: string, id: string, roll: number) =>
  studentFactory({
    id,
    full_name: name,
    roll_number: roll,
    class_section: classSectionFactory({
      section_name: 'A',
      class: classFactory({ name: 'Class 6' }),
    }),
  });
const FATIMA = child('Fatima Rahman', 'student-1', 14);
const IMRAN = child('Imran Rahman', 'student-2', 7);

function render(
  rows: unknown[],
  { students = [FATIMA, IMRAN], path = '/portal/applications' } = {},
) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get('/api/v1/students/mine', () => HttpResponse.json(students)),
    http.get('/api/v1/applications', ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        data: rows,
        total: rows.length,
        page: 1,
        limit: 25,
        totalPages: 1,
      });
    }),
  );
  const r = renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role: 'PARENT',
    accessToken: TOKEN,
    locale: 'en',
  });
  return { ...r, queries };
}

const row = (over: Record<string, unknown>) => ({
  ...applicationDto({
    type: 'STUDENT_LEAVE',
    payload: { reason_kind: 'SICK', start_date: '2026-10-13', end_date: '2026-10-15' },
    start_date: '2026-10-13',
    end_date: '2026-10-15',
  }),
  ref_names: {},
  ...over,
});

describe('/portal/applications', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists the first child, asks for that student_id, and refetches when the child changes', async () => {
    const { queries } = render([row({})]);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Applications' })).toBeTruthy();
    await waitFor(() =>
      expect(queries.some((q) => q.get('student_id') === 'student-1')).toBe(true),
    );
    const last = queries.at(-1)!;
    expect(last.get('view')).toBe('mine');
    expect(last.get('limit')).toBe('25');
    await user.click(await screen.findByRole('link', { name: /Imran Rahman/ }));
    await waitFor(() =>
      expect(queries.some((q) => q.get('student_id') === 'student-2')).toBe(true),
    );
  });

  it('a card shows the Latin serial, the status and who filed it', async () => {
    render([
      row({ id: 'a1', serial: '2026/0046', applicant_user_id: 'u-me', applicant_name: 'Me' }),
      row({
        id: 'a2',
        serial: '2026/0047',
        applicant_user_id: 'u-other',
        applicant_name: 'Rahim',
        status: 'APPROVED',
        decided_by_name: 'Head',
        decided_at: '2026-10-05T04:00:00.000Z',
      }),
      row({ id: 'a3', serial: '2026/0048', source: 'PAPER', applicant_user_id: null }),
    ]);
    expect(await screen.findByText(/2026\/0046/)).toBeTruthy();
    expect(screen.getByText(/You submitted this/)).toBeTruthy();
    expect(screen.getByText(/Rahim submitted this/)).toBeTruthy();
    expect(screen.getByText(/Submitted on paper at school/)).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText(/Decided on/)).toBeTruthy();
    const link = screen.getAllByRole('link', { name: /Student leave/ })[0]!;
    expect(link.getAttribute('href')).toBe('/portal/applications/a1');
  });

  it('shows an empty state and links "New application" with ?student=', async () => {
    render([]);
    expect(await screen.findByText('No applications yet')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'New application' });
    expect(link.getAttribute('href')).toBe('/portal/applications/new?student=student-1');
  });

  it('with no linked child shows the "no student" card', async () => {
    render([], { students: [] });
    expect(await screen.findByText('No students linked to you yet')).toBeTruthy();
  });
});
