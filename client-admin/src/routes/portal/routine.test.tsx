import {
  cleanupTestState,
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

// Same "frozen clock at collection time" reasoning `fees.test.tsx` documents
// for its own fixtures.
vi.useFakeTimers({ toFake: ['Date'] });
afterAll(() => {
  vi.useRealTimers();
});
vi.setSystemTime(new Date('2026-09-23T09:00:00.000Z'));

afterEach(async () => {
  await cleanupTestState();
});

function child(name: string, id: string, className: string, section: string, roll: number) {
  return studentFactory({
    id,
    full_name: name,
    roll_number: roll,
    // academic_year_id 'year-1' matches ROUTINE's own year below —
    // hasPublishableRoutine now scopes to the selected child's class
    // year, so a mismatched random factory year would hide the routine.
    class_section: classSectionFactory({
      section_name: section,
      class: classFactory({ name: className, academic_year_id: 'year-1' }),
    }),
  });
}

function mockCommonLookups() {
  server.use(
    http.get('/api/v1/subjects', () =>
      HttpResponse.json({
        data: [
          { id: 'subject-en', name_en: 'English', name_bn: null, code: 'ENG', is_active: true },
        ],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/routines/rooms', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
    http.get('/api/v1/routines/shifts', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
    http.get('/api/v1/calendar-settings', () =>
      HttpResponse.json({
        termLabel: 'TERM',
        country: 'BD',
        firstDayOfWeek: 0,
        weeklyOffDays: [5],
        timezone: 'Asia/Dhaka',
      }),
    ),
    http.get('/api/v1/calendar/events', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
    http.get('/api/v1/routines/resolve', () => HttpResponse.json([])),
  );
}

const ROUTINE = { id: 'routine-1', academic_year_id: 'year-1', created_at: '2026-01-01T00:00:00Z' };

describe('/portal/routine', () => {
  it("says the school hasn't published a routine yet when none exists", async () => {
    mockCommonLookups();
    const fatima = child('Fatima', 'student-1', 'Class 6', 'A', 12);
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json([fatima])),
      http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'DRAFT' }])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/portal/routine'],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(/hasn't published a routine yet/i)).toBeTruthy());
  });

  it("renders the resolved student's section day, and switches child via the fees-portal picker", async () => {
    mockCommonLookups();
    const fatima = child('Fatima', 'student-1', 'Class 6', 'A', 12);
    const rafi = child('Rafi', 'student-2', 'Class 4', 'B', 3);
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json([fatima, rafi])),
      http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'PUBLISHED' }])),
      http.get('/api/v1/routines/resolve', ({ request }) => {
        const url = new URL(request.url);
        const studentId = url.searchParams.get('student_id');
        const from = url.searchParams.get('from') ?? '2026-09-23';
        if (studentId !== 'student-1') return HttpResponse.json([]);
        return HttpResponse.json([
          {
            date: from,
            routine_slot_id: 'slot-1',
            section_id: 'section-1',
            period_slot_id: 'period-1',
            weekday: 3,
            subject_id: 'subject-en',
            room_id: null,
            kind: 'CLASS',
            teacher_ids: [],
            substituted: false,
            cancelled: false,
          },
        ]);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/portal/routine'],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(/English/)).toBeTruthy());

    await userEvent.click(screen.getByRole('link', { name: /rafi/i }));
    await waitFor(() => expect(screen.getByText('No classes.')).toBeTruthy());
  });
});
