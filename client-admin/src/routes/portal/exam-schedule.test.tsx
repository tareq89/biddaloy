import {
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
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
});
