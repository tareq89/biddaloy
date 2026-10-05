import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import {
  apiErrorBody,
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { formatDate, formatWeekday } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

// Frozen so "today" and "finished" mean the same thing at any hour. Only
// `Date` is faked, so MSW and `waitFor` keep their real timers.
vi.useFakeTimers({ toFake: ['Date'] });
afterAll(() => {
  vi.useRealTimers();
});
vi.setSystemTime(new Date('2026-02-05T10:00:00.000Z'));

/**
 * [19.11.1] Portal exam schedule — visibility is entirely server side
 * (`GET /students/:studentId/exam-schedule`), so this only needs to check
 * upcoming-first sort and multi-child guardian switching (reusing
 * `results.tsx`'s picker pattern, same as `results.test.tsx`).
 */
describe('/portal/exam-schedule', () => {
  afterEach(() => {
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

  const fatima = child('Fatima Rahman', 'student-1', 'Class 8', 'B', 14);
  const imran = child('Imran Rahman', 'student-2', 'Class 3', 'A', 7);

  function row(examId: string, subjectName: string, date: string, startsAt: string) {
    return {
      id: `${examId}-${subjectName}`,
      exam_id: examId,
      exam: { id: examId, name: 'First Term Exam', kind: 'TERM' },
      subject_id: subjectName,
      subject: { id: subjectName, name_en: subjectName, name_bn: subjectName },
      date,
      starts_at: startsAt,
      ends_at: '11:00:00',
      venue: 'Main Hall',
    };
  }

  function mockSchedule(options: { students: unknown[]; schedule: Record<string, unknown[]> }) {
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json(options.students)),
      http.get('/api/v1/students/:studentId/exam-schedule', ({ params }) => {
        const id = params.studentId as string;
        return HttpResponse.json(options.schedule[id] ?? []);
      }),
    );
  }

  function renderSchedule(path = '/portal/exam-schedule', locale = 'en') {
    return renderWithRouter(routeTree, {
      initialEntries: [path],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale,
    });
  }

  /** The body rows of the exam's table, header row dropped. */
  function bodyRows(tableName: string): HTMLElement[] {
    return within(screen.getByRole('table', { name: tableName }))
      .getAllByRole('row')
      .slice(1);
  }

  const longDate = (iso: string) =>
    `${formatWeekday(iso, REGION_BD_EN)}, ${formatDate(iso, REGION_BD_EN)}`;

  it('shows the schedule sorted upcoming-first, with long dates and times without seconds', async () => {
    mockSchedule({
      students: [fatima],
      schedule: {
        'student-1': [
          row('exam-1', 'English', '2026-02-06', '09:00:00'),
          row('exam-1', 'Mathematics', '2026-02-05', '09:00:00'),
        ],
      },
    });

    renderSchedule();

    await screen.findByRole('heading', { level: 1, name: 'Exam schedule' });
    const rows = bodyRows('First Term Exam');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Mathematics')).toBeTruthy();
    expect(within(rows[0]!).getByText(longDate('2026-02-05'))).toBeTruthy();
    expect(within(rows[1]!).getByText('English')).toBeTruthy();
    expect(within(rows[1]!).getByText(longDate('2026-02-06'))).toBeTruthy();
    // Times read as 9:00 AM – 11:00 AM, never the raw 09:00:00 / ISO date.
    expect(screen.queryByText(/09:00:00/)).toBeNull();
    expect(screen.queryByText(/2026-02-0[56]/)).toBeNull();
    expect(within(rows[0]!).getByText(/9:00 AM – 11:00 AM/)).toBeTruthy();
  });

  it('renders one table per exam, ordered by the exam\u2019s first sitting', async () => {
    const later = { ...row('exam-2', 'Science', '2026-03-01', '10:00:00') };
    later.exam = { id: 'exam-2', name: 'Final Exam', kind: 'TERM' };
    mockSchedule({
      students: [fatima],
      schedule: { 'student-1': [later, row('exam-1', 'Mathematics', '2026-02-05', '09:00:00')] },
    });

    renderSchedule();

    await screen.findByRole('heading', { level: 2, name: 'First Term Exam' });
    const titles = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent)
      .filter((name) => name === 'First Term Exam' || name === 'Final Exam');
    expect(titles).toEqual(['First Term Exam', 'Final Exam']);
    expect(screen.getAllByRole('table')).toHaveLength(2);
  });

  it('badges a past sitting "Finished" and today\u2019s sitting "Today"', async () => {
    mockSchedule({
      students: [fatima],
      schedule: {
        'student-1': [
          row('exam-1', 'English', '2026-02-04', '09:00:00'),
          row('exam-1', 'Mathematics', '2026-02-05', '09:00:00'),
          row('exam-1', 'Science', '2026-02-06', '09:00:00'),
        ],
      },
    });

    renderSchedule();

    await screen.findByRole('table', { name: 'First Term Exam' });
    const [past, today, future] = bodyRows('First Term Exam') as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(within(past).getByText('Finished')).toBeTruthy();
    expect(within(today).getByText('Today')).toBeTruthy();
    expect(within(future).queryByText('Finished')).toBeNull();
    expect(within(future).queryByText('Today')).toBeNull();
  });

  it('names the first sitting dated today or later in the next-exam card', async () => {
    mockSchedule({
      students: [fatima],
      schedule: {
        'student-1': [
          row('exam-1', 'English', '2026-02-04', '09:00:00'),
          row('exam-1', 'Science', '2026-02-06', '10:00:00'),
          row('exam-1', 'Mathematics', '2026-02-07', '09:00:00'),
        ],
      },
    });

    renderSchedule();

    const card = await screen.findByRole('complementary', { name: 'Next exam' });
    expect(within(card).getByText('Science')).toBeTruthy();
    expect(within(card).getByText('First Term Exam')).toBeTruthy();
    expect(within(card).getByText(longDate('2026-02-06'))).toBeTruthy();
    expect(within(card).getByText('Main Hall')).toBeTruthy();
  });

  it('has no next-exam card when every sitting is in the past', async () => {
    mockSchedule({
      students: [fatima],
      schedule: { 'student-1': [row('exam-1', 'English', '2026-02-01', '09:00:00')] },
    });

    renderSchedule();

    await screen.findByRole('table', { name: 'First Term Exam' });
    expect(screen.queryByRole('complementary', { name: 'Next exam' })).toBeNull();
  });

  it('shows the Bangla subject name in Bangla', async () => {
    const bn = row('exam-1', 'Mathematics', '2026-02-06', '09:00:00');
    bn.subject = { id: 'm', name_en: 'Mathematics', name_bn: 'গণিত' };
    mockSchedule({ students: [fatima], schedule: { 'student-1': [bn] } });

    const { localeReady } = renderSchedule('/portal/exam-schedule', 'bn');
    await localeReady;

    expect(await within(await screen.findByRole('table')).findByText('গণিত')).toBeTruthy();
    expect(screen.queryByText('Mathematics')).toBeNull();
  });

  it('switches between children with the multi-child picker', async () => {
    const user = userEvent.setup();
    mockSchedule({
      students: [fatima, imran],
      schedule: {
        'student-1': [row('exam-1', 'Mathematics', '2026-02-05', '09:00:00')],
        'student-2': [row('exam-2', 'Science', '2026-03-01', '10:00:00')],
      },
    });

    renderSchedule();

    await within(await screen.findByRole('table')).findByText('Mathematics');
    const picker = await screen.findByRole('navigation', { name: 'Choose a student' });
    await user.click(within(picker).getByRole('link', { name: /Imran Rahman/ }));

    await within(await screen.findByRole('table', { name: 'First Term Exam' })).findByText(
      'Science',
    );
    expect(screen.queryByText('Mathematics')).toBeNull();
  });

  it('breaks a same-day tie by start time', async () => {
    mockSchedule({
      students: [fatima],
      schedule: {
        'student-1': [
          row('exam-1', 'English', '2026-02-05', '13:00:00'),
          row('exam-1', 'Mathematics', '2026-02-05', '09:00:00'),
        ],
      },
    });

    renderSchedule();

    await screen.findByRole('table', { name: 'First Term Exam' });
    const rows = bodyRows('First Term Exam');
    expect(within(rows[0]!).getByText('Mathematics')).toBeTruthy();
    expect(within(rows[1]!).getByText('English')).toBeTruthy();
  });

  it('says the subject is not set, never shows its id, and shows a dash for a missing venue', async () => {
    mockSchedule({
      students: [fatima],
      schedule: {
        'student-1': [
          {
            ...row('exam-1', 'subject-42', '2026-02-06', '09:00:00'),
            subject: null,
            venue: null,
          },
        ],
      },
    });

    renderSchedule();

    const table = await screen.findByRole('table', { name: 'First Term Exam' });
    expect(within(table).getByText('Subject not set')).toBeTruthy();
    expect(within(table).getByText('—')).toBeTruthy();
    expect(screen.queryByText('subject-42')).toBeNull();
    expect(screen.queryByText('Main Hall')).toBeNull();
  });

  it('shows only the roll number for a student with no class', async () => {
    mockSchedule({
      students: [{ ...fatima, class_section: null }],
      schedule: { 'student-1': [row('exam-1', 'Mathematics', '2026-02-05', '09:00:00')] },
    });

    renderSchedule();

    expect(await screen.findByText('Fatima Rahman · Roll 14')).toBeTruthy();
  });

  it('shows a friendly empty message when the school has not published a schedule', async () => {
    mockSchedule({ students: [fatima], schedule: { 'student-1': [] } });

    renderSchedule();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No exam schedule yet' }),
    ).toBeTruthy();
    // The page frame is still there — this is not an error.
    expect(screen.getByRole('heading', { level: 1, name: 'Exam schedule' })).toBeTruthy();
  });

  it('shows the "no students linked" state when the guardian has no children', async () => {
    mockSchedule({ students: [], schedule: {} });

    renderSchedule();

    expect(await screen.findByText('No students linked to you yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('shows a retryable error when the student list fails to load', async () => {
    server.use(
      http.get('/api/v1/students/mine', () =>
        HttpResponse.json(apiErrorBody(403, 'Forbidden', '/api/v1/students/mine'), {
          status: 403,
        }),
      ),
    );

    renderSchedule();

    expect(await screen.findByText(/Could not load the exam schedule/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('shows a retryable error when the schedule itself fails to load', async () => {
    let scheduleRequests = 0;
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json([fatima])),
      http.get('/api/v1/students/:studentId/exam-schedule', () => {
        scheduleRequests += 1;
        return HttpResponse.json(
          apiErrorBody(404, 'Not found', '/api/v1/students/student-1/exam-schedule'),
          { status: 404 },
        );
      }),
    );

    renderSchedule();

    expect(await screen.findByText(/Could not load the exam schedule/)).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();

    // "Try again" re-requests the schedule (a 404 is never auto-retried,
    // so the count before the click is exactly one).
    expect(scheduleRequests).toBe(1);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(scheduleRequests).toBe(2));
  });

  it('is axe clean', async () => {
    mockSchedule({
      students: [fatima],
      schedule: {
        'student-1': [
          row('exam-1', 'English', '2026-02-04', '09:00:00'),
          row('exam-1', 'Mathematics', '2026-02-06', '09:00:00'),
        ],
      },
    });

    const { container } = renderSchedule();

    await screen.findByRole('table', { name: 'First Term Exam' });
    await expect(container).toHaveNoViolations();
  });
});
