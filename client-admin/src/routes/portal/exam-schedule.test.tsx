import {
  apiErrorBody,
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

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

  function renderSchedule(path = '/portal/exam-schedule') {
    return renderWithRouter(routeTree, {
      initialEntries: [path],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale: 'en',
    });
  }

  it('shows the schedule sorted upcoming-first', async () => {
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

    await screen.findByRole('heading', { name: 'Exam schedule' });
    const rows = await screen.findAllByText(/2026-02-0[56]/);
    expect(rows[0]).toHaveProperty('textContent', expect.stringContaining('2026-02-05'));
    expect(rows[1]).toHaveProperty('textContent', expect.stringContaining('2026-02-06'));
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

    await screen.findByText('Mathematics');
    const picker = await screen.findByRole('navigation', { name: 'Choose a student' });
    await user.click(within(picker).getByRole('link', { name: /Imran Rahman/ }));

    await screen.findByText('Science');
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

    const times = await screen.findAllByText(/2026-02-05 ·/);
    expect(times[0]?.textContent).toContain('09:00:00');
    expect(times[1]?.textContent).toContain('13:00:00');
  });

  it('falls back to the subject id and hides the venue line when the row has neither', async () => {
    mockSchedule({
      students: [fatima],
      schedule: {
        'student-1': [
          {
            ...row('exam-1', 'subject-42', '2026-02-05', '09:00:00'),
            subject: null,
            venue: null,
          },
        ],
      },
    });

    renderSchedule();

    expect(await screen.findByText('subject-42')).toBeTruthy();
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

    expect(await screen.findByText(/No exam schedule yet/)).toBeTruthy();
    // The page frame is still there — this is not an error.
    expect(screen.getByRole('heading', { name: 'Exam schedule' })).toBeTruthy();
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
});
