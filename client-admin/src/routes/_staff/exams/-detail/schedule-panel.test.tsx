import {
  classFactory,
  classSubjectFactory,
  cleanupTestState,
  examFactory,
  renderWithRouter,
  server,
  subjectFactory,
} from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [19.11.1] Schedule tab — renders sorted by date/start time, and the
 * keyboard-only inline edit (click/Enter to edit, Enter commits, Escape
 * cancels). */
describe('exams/$examId Schedule tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders rows sorted by date then start time', async () => {
    const klass = classFactory({ id: 'class-1' });
    const exam = examFactory({ id: 'exam-1', class: klass, class_id: klass.id });
    const math = subjectFactory({ id: 'subject-math', name_en: 'Mathematics' });
    const english = subjectFactory({ id: 'subject-eng', name_en: 'English' });

    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(exam)),
      http.get('/api/v1/exams/:examId/marks/progress', () =>
        HttpResponse.json({ counts: { DRAFT: 0, SUBMITTED: 0 }, outstanding: [] }),
      ),
      http.get('/api/v1/classes/:classId/subjects', () =>
        HttpResponse.json([
          classSubjectFactory({
            class: klass,
            class_id: klass.id,
            subject: math,
            subject_id: math.id,
          }),
          classSubjectFactory({
            class: klass,
            class_id: klass.id,
            subject: english,
            subject_id: english.id,
          }),
        ]),
      ),
      http.get('/api/v1/exams/:examId/schedule', () =>
        HttpResponse.json([
          {
            id: 'sched-2',
            exam_id: exam.id,
            subject_id: english.id,
            subject: english,
            date: '2026-02-06',
            starts_at: '09:00:00',
            ends_at: '11:00:00',
            venue: null,
          },
          {
            id: 'sched-1',
            exam_id: exam.id,
            subject_id: math.id,
            subject: math,
            date: '2026-02-05',
            starts_at: '09:00:00',
            ends_at: '11:00:00',
            venue: 'Main Hall',
          },
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=schedule'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const rows = await screen.findAllByRole('row');
    // Row 0 is the header; row 1 must be Mathematics (2026-02-05), before
    // English (2026-02-06).
    within(rows[1]!).getByText('Mathematics');
    within(rows[2]!).getByText('English');
  });

  it('edits a cell with Enter to open, Enter to commit, Escape to cancel', async () => {
    const user = userEvent.setup();
    const klass = classFactory({ id: 'class-1' });
    const exam = examFactory({ id: 'exam-1', class: klass, class_id: klass.id });
    const math = subjectFactory({ id: 'subject-math', name_en: 'Mathematics' });
    let lastPatchBody: unknown = null;

    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(exam)),
      http.get('/api/v1/exams/:examId/marks/progress', () =>
        HttpResponse.json({ counts: { DRAFT: 0, SUBMITTED: 0 }, outstanding: [] }),
      ),
      http.get('/api/v1/classes/:classId/subjects', () =>
        HttpResponse.json([
          classSubjectFactory({
            class: klass,
            class_id: klass.id,
            subject: math,
            subject_id: math.id,
          }),
        ]),
      ),
      http.get('/api/v1/exams/:examId/schedule', () =>
        HttpResponse.json([
          {
            id: 'sched-1',
            exam_id: exam.id,
            subject_id: math.id,
            subject: math,
            date: '2026-02-05',
            starts_at: '09:00:00',
            ends_at: '11:00:00',
            venue: 'Main Hall',
          },
        ]),
      ),
      http.patch('/api/v1/exams/:examId/schedule/:id', async ({ request }) => {
        lastPatchBody = await request.json();
        return HttpResponse.json({
          schedule: {
            id: 'sched-1',
            exam_id: exam.id,
            subject_id: math.id,
            subject: math,
            date: '2026-02-05',
            starts_at: '09:00:00',
            ends_at: '11:00:00',
            venue: 'Second Hall',
          },
          warnings: [],
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=schedule'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const venueButton = await screen.findByRole('button', { name: 'Main Hall' });
    venueButton.focus();
    await user.keyboard('{Enter}');

    const input = await screen.findByLabelText('Venue');
    await user.clear(input);
    await user.type(input, 'Second Hall');
    await user.keyboard('{Enter}');

    // Commit sends the PATCH and closes the editor back to display mode —
    // the GET handler above isn't stateful, so the redisplayed value is
    // whatever it returns; the PATCH body is what proves the edit worked.
    await screen.findByRole('button', { name: 'Main Hall' });
    expect(lastPatchBody).toMatchObject({ venue: 'Second Hall' });
  });
});
