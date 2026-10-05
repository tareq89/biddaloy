import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const SECTION = {
  section_id: 'section-1',
  section_name: 'A',
  class_id: 'class-7',
  class_name: 'Class 7',
  assignment_type: 'CLASS_TEACHER',
};

const paged = (data: unknown[]) => ({
  data,
  total: data.length,
  page: 1,
  limit: 10,
  totalPages: 1,
});

/** Every endpoint the six cards call; `overrides` replaces one of them. */
function mockAll(overrides: Parameters<typeof server.use> = []) {
  server.use(
    ...overrides,
    http.get('/api/v1/my-class/sections', () => HttpResponse.json([SECTION])),
    http.get('/api/v1/attendance/sections/section-1/register', () =>
      HttpResponse.json({
        students: [
          { student_id: 's1', roll_number: 1, full_name: 'Rafi Absent', status: 'ABSENT' },
          { student_id: 's2', roll_number: 2, full_name: 'Mina Present', status: 'PRESENT' },
        ],
      }),
    ),
    http.get('/api/v1/attendance/sections/section-1/streaks', () =>
      HttpResponse.json({
        as_of_date: '2026-10-01',
        items: [
          {
            student_id: 's3',
            student_name: 'Tania Late',
            roll_number: 3,
            status: 'LATE',
            length: 4,
            since_date: '2026-09-28',
          },
        ],
      }),
    ),
    http.get('/api/v1/fees/dues', () =>
      HttpResponse.json(
        paged([{ student_id: 's1', full_name: 'Rafi Absent', total_due: 500, dues: [] }]),
      ),
    ),
    http.get('/api/v1/homework/analytics/section/section-1', () =>
      HttpResponse.json({
        totalAssignments: 7,
        completed: 5,
        defaulters: 2,
        completionPercent: 71,
      }),
    ),
    http.get('/api/v1/exams', () =>
      HttpResponse.json(
        paged([
          {
            id: 'exam-1',
            name: 'Half Yearly',
            status: 'PUBLISHED',
            published_at: '2026-09-30T00:00:00Z',
            academic_year_id: 'year-1',
          },
          { id: 'exam-0', name: 'Draft Test', status: 'DRAFT', published_at: null },
        ]),
      ),
    ),
    http.get('/api/v1/performance/classes/class-7', () =>
      HttpResponse.json({
        exams: [
          {
            examId: 'exam-1',
            examName: 'Half Yearly',
            appeared: 30,
            passRate: 90,
            averageMarks: 72,
          },
        ],
      }),
    ),
    http.get('/api/v1/exams/exam-1/analysis/defaulted', () =>
      HttpResponse.json({
        status: 'OK',
        rows: [{ student_id: 's4', full_name: 'Karim Failed', roll_number: 4, is_fail: true }],
      }),
    ),
    http.get('/api/v1/students', () =>
      HttpResponse.json(
        paged([
          {
            id: 's1',
            full_name: 'Rafi Absent',
            roll_number: 1,
            guardians: [{ phone: '01700000000', is_primary_contact: true }],
          },
        ]),
      ),
    ),
  );
}

function render(entry = '/my-class/section-1') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: 'TEACHER',
    locale: 'en',
  });
}

describe('/my-class/$sectionId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders all six cards and focuses the attendance button first', async () => {
    mockAll();
    render();
    const button = await screen.findByRole('link', { name: "Take today's attendance" });
    expect(button.getAttribute('href')).toContain('/attendance/section-1');
    await waitFor(() => expect(document.activeElement).toBe(button));

    expect(await screen.findByRole('heading', { name: 'My class · Class 7-A' })).toBeTruthy();
    for (const title of [
      'Absent today',
      'Attendance flags',
      'Dues',
      'Homework',
      'Results',
      'Students',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    expect(await screen.findByText('Late 3 or more days in a row')).toBeTruthy();
    expect(await screen.findByText('Half Yearly')).toBeTruthy();
    expect(await screen.findByText('Karim Failed')).toBeTruthy();
    const tel = await screen.findByRole('link', { name: 'Call guardian of Rafi Absent' });
    expect(tel.getAttribute('href')).toBe('tel:01700000000');
  });

  it('names the section, not its id, in the breadcrumb and tab title', async () => {
    mockAll();
    render();
    const nav = await screen.findByRole('navigation', { name: 'You are here' });
    await waitFor(() => expect(within(nav).getByText('Class 7-A')).toBeTruthy());
    expect(within(nav).queryByText('section-1')).toBeNull();
    await waitFor(() => expect(document.title).toContain('Class 7-A'));
  });

  it('keeps the other cards when one card fails, and retries just that card', async () => {
    mockAll([
      http.get('/api/v1/attendance/sections/section-1/streaks', () =>
        HttpResponse.json({}, { status: 403 }),
      ),
    ]);
    render();
    const flags = (await screen.findByRole('heading', { name: 'Attendance flags' })).closest(
      'section',
    )!;
    expect(await within(flags).findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(await screen.findByText('Half Yearly')).toBeTruthy();
    expect((await screen.findAllByText('Rafi Absent')).length).toBeGreaterThan(0);
  });

  it('shows the empty line when the class has no published exam', async () => {
    mockAll([http.get('/api/v1/exams', () => HttpResponse.json(paged([])))]);
    render();
    expect(await screen.findByText('No results yet.')).toBeTruthy();
  });

  // `/fees/dues` needs FEE_COLLECT, which TEACHER lacks (FEE_READ only):
  // the Dues card must not offer a link that lands on access-denied.
  it('hides the Dues "See all" link from a TEACHER', async () => {
    mockAll();
    render();
    const dues = (await screen.findByRole('heading', { name: 'Dues' })).closest('section')!;
    expect(await within(dues).findByText('Rafi Absent')).toBeTruthy();
    expect(within(dues).queryByRole('link', { name: 'See all' })).toBeNull();
  });

  it('says attendance is not taken yet when no student has a status', async () => {
    mockAll([
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json({
          students: [{ student_id: 's1', roll_number: 1, full_name: 'Rafi', status: null }],
        }),
      ),
    ]);
    render();
    expect(await screen.findByText('Attendance not taken yet.')).toBeTruthy();
    expect(screen.queryByText('No one is absent today.')).toBeNull();
  });

  it('shows the not-found page for a section the teacher does not own', async () => {
    mockAll();
    render('/my-class/someone-elses-section');
    expect(await screen.findByText(/not found|doesn.t exist|404/i)).toBeTruthy();
  });
});
