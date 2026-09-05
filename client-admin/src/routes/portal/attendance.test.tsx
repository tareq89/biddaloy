import {
  cleanupTestState,
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

// Frozen so "this month" means the same thing at 00:07 as it does at
// 14:00 — same reasoning `fees.test.tsx` documents for its own clock.
vi.useFakeTimers({ toFake: ['Date'] });

afterAll(() => {
  vi.useRealTimers();
});

vi.setSystemTime(new Date('2026-09-15T10:00:00.000Z'));

const FATIMA_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const IMRAN_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

/**
 * [9.9]'s portal month-grid attendance view, exercised through the real
 * route tree — same reasoning `fees.test.tsx` documents for itself.
 */
describe('/portal/attendance', () => {
  afterEach(async () => {
    await cleanupTestState();
    vi.unstubAllGlobals();
  });

  function child(name: string, id: string, className: string, section: string, roll: number) {
    return studentFactory({
      id,
      full_name: name,
      roll_number: roll,
      class_section: classSectionFactory({
        section_name: section,
        class: classFactory({ name: className }),
      }),
    });
  }

  function attendanceDay(overrides: {
    date: string;
    status?: 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE' | null;
    minutes_late?: number | null;
    remarks?: string | null;
    is_working_day?: boolean;
    holiday_name?: string | null;
  }) {
    return {
      date: overrides.date,
      status: overrides.status ?? null,
      minutes_late: overrides.minutes_late ?? null,
      remarks: overrides.remarks ?? null,
      is_working_day: overrides.is_working_day ?? true,
      holiday_name: overrides.holiday_name ?? null,
    };
  }

  function summary(studentId: string, overrides: Partial<Record<string, unknown>> = {}) {
    return {
      student_id: studentId,
      from: '2026-09-01',
      to: '2026-09-30',
      working_days: 22,
      marked_days: 10,
      present_days: 8,
      late_days: 1,
      absent_days: 1,
      leave_days: 0,
      unmarked_days: 12,
      attendance_percentage: 90,
      policy: {
        late_counts_as_present: true,
        leave_counts_as_working_day: true,
        denominator: 'WORKING_DAYS',
      },
      ...overrides,
    };
  }

  const daysRequests: { studentId: string; month: string }[] = [];
  const summaryRequests: { studentId: string; month: string }[] = [];

  function mockAttendance(options: {
    students: unknown[];
    days: Record<string, unknown[]>;
    summaries: Record<string, unknown>;
  }) {
    daysRequests.length = 0;
    summaryRequests.length = 0;
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json(options.students)),
      http.get('/api/v1/attendance/students/:studentId/days', ({ params, request }) => {
        const studentId = params.studentId as string;
        const month = new URL(request.url).searchParams.get('month') ?? '';
        daysRequests.push({ studentId, month });
        return HttpResponse.json(options.days[studentId] ?? []);
      }),
      http.get('/api/v1/attendance/students/:studentId/summary', ({ params, request }) => {
        const studentId = params.studentId as string;
        const month = new URL(request.url).searchParams.get('month') ?? '';
        summaryRequests.push({ studentId, month });
        return HttpResponse.json(options.summaries[studentId] ?? summary(studentId));
      }),
    );
  }

  function renderAttendance(path = '/portal/attendance', locale = 'en') {
    return renderWithRouter(routeTree, {
      initialEntries: [path],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale,
    });
  }

  const fatima = child('Fatima Rahman', FATIMA_ID, 'Class 8', 'B', 14);
  const imran = child('Imran Rahman', IMRAN_ID, 'Class 3', 'A', 7);

  it('renders the summary card and month grid for the default (first-linked) student', async () => {
    mockAttendance({
      students: [fatima, imran],
      days: {
        [FATIMA_ID]: [
          attendanceDay({ date: '2026-09-01', status: 'PRESENT' }),
          attendanceDay({ date: '2026-09-02', status: 'ABSENT' }),
        ],
      },
      summaries: { [FATIMA_ID]: summary(FATIMA_ID) },
    });
    renderAttendance();

    await waitFor(() =>
      expect(summaryRequests).toContainEqual({ studentId: FATIMA_ID, month: '2026-09' }),
    );
    expect(daysRequests).toContainEqual({ studentId: FATIMA_ID, month: '2026-09' });
    expect(await screen.findByText('90%')).toBeTruthy();
    expect(screen.getByRole('button', { name: /2026-09-01/ })).toBeTruthy();
  });

  it('renders a picker for more than one linked student and re-queries on switch', async () => {
    mockAttendance({
      students: [fatima, imran],
      days: { [FATIMA_ID]: [], [IMRAN_ID]: [] },
      summaries: { [FATIMA_ID]: summary(FATIMA_ID), [IMRAN_ID]: summary(IMRAN_ID) },
    });
    renderAttendance();

    const picker = await screen.findByRole('navigation', { name: 'Choose a student' });
    await waitFor(() => expect(summaryRequests.map((r) => r.studentId)).toContain(FATIMA_ID));

    await userEvent.click(within(picker).getByRole('link', { name: /Imran Rahman/ }));

    await waitFor(() => expect(summaryRequests.map((r) => r.studentId)).toContain(IMRAN_ID));
    expect(daysRequests.map((r) => r.studentId)).toContain(IMRAN_ID);
  });

  it('renders no picker for a caller who can see exactly one student', async () => {
    mockAttendance({
      students: [fatima],
      days: { [FATIMA_ID]: [] },
      summaries: { [FATIMA_ID]: summary(FATIMA_ID) },
    });
    renderAttendance();

    await screen.findByRole('heading', { level: 1, name: 'Attendance' });
    expect(screen.queryByRole('navigation', { name: 'Choose a student' })).toBeNull();
  });

  it('renders "—" and never "0%" when attendance_percentage is null', async () => {
    mockAttendance({
      students: [fatima],
      days: { [FATIMA_ID]: [] },
      summaries: { [FATIMA_ID]: summary(FATIMA_ID, { attendance_percentage: null }) },
    });
    renderAttendance();

    expect(await screen.findByText('Not enough marked days this month')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('explains an account with no students linked to it', async () => {
    mockAttendance({ students: [], days: {}, summaries: {} });
    renderAttendance();

    expect(await screen.findByText('No students linked to you yet')).toBeTruthy();
    expect(daysRequests).toHaveLength(0);
  });

  it('says so plainly when the month has no records at all', async () => {
    mockAttendance({
      students: [fatima],
      days: { [FATIMA_ID]: [] },
      summaries: { [FATIMA_ID]: summary(FATIMA_ID) },
    });
    renderAttendance();

    expect(await screen.findByText('No attendance records for this month yet.')).toBeTruthy();
  });

  it('opens a dialog with status, minutes late and remarks when a marked day is selected', async () => {
    mockAttendance({
      students: [fatima],
      days: {
        [FATIMA_ID]: [
          attendanceDay({
            date: '2026-09-03',
            status: 'LATE',
            minutes_late: 12,
            remarks: 'Bus was late',
          }),
        ],
      },
      summaries: { [FATIMA_ID]: summary(FATIMA_ID) },
    });
    renderAttendance();

    const cell = await screen.findByRole('button', { name: /2026-09-03/ });
    await userEvent.click(cell);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Bus was late')).toBeTruthy();
    expect(within(dialog).getByText('12')).toBeTruthy();
  });

  it('steps to the previous and next month via real links, rewriting ?month=', async () => {
    mockAttendance({
      students: [fatima],
      days: { [FATIMA_ID]: [] },
      summaries: { [FATIMA_ID]: summary(FATIMA_ID) },
    });
    renderAttendance();

    await waitFor(() =>
      expect(daysRequests).toContainEqual({ studentId: FATIMA_ID, month: '2026-09' }),
    );

    await userEvent.click(screen.getByRole('link', { name: /Previous month/ }));
    await waitFor(() =>
      expect(daysRequests).toContainEqual({ studentId: FATIMA_ID, month: '2026-08' }),
    );

    await userEvent.click(screen.getByRole('link', { name: /Next month/ }));
    await waitFor(() =>
      expect(daysRequests).toContainEqual({ studentId: FATIMA_ID, month: '2026-09' }),
    );
  });

  it('shows a retryable error, with no h1, when the days/summary fetch fails', async () => {
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json([fatima])),
      http.get('/api/v1/attendance/students/:studentId/days', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
      http.get('/api/v1/attendance/students/:studentId/summary', () =>
        HttpResponse.json(summary(FATIMA_ID)),
      ),
    );
    renderAttendance();

    expect(
      await screen.findByText(/Could not load this student's attendance/, {}, { timeout: 15000 }),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('is axe clean', async () => {
    mockAttendance({
      students: [fatima],
      days: {
        [FATIMA_ID]: [attendanceDay({ date: '2026-09-01', status: 'PRESENT' })],
      },
      summaries: { [FATIMA_ID]: summary(FATIMA_ID) },
    });
    const { container } = renderAttendance();

    await screen.findByText('90%');
    await expect(container).toHaveNoViolations();
  });
});
