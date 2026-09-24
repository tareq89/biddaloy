import {
  apiErrorBody,
  classFactory,
  classSubjectFactory,
  cleanupTestState,
  examFactory,
  renderWithRouter,
  server,
  subjectFactory,
} from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

  // --- Shared fixtures for the tests below -------------------------------

  const klass = classFactory({ id: 'class-1' });
  const exam = examFactory({ id: 'exam-1', class: klass, class_id: klass.id });
  const math = subjectFactory({ id: 'subject-math', name_en: 'Mathematics' });
  const english = subjectFactory({ id: 'subject-eng', name_en: 'English' });

  function scheduleRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'sched-1',
      exam_id: exam.id,
      subject_id: math.id,
      subject: math,
      date: '2026-02-05',
      starts_at: '09:00:00',
      ends_at: '11:00:00',
      venue: 'Main Hall',
      ...overrides,
    };
  }

  /** Mocks everything the Schedule tab loads. Returns the bodies of every
   * PATCH/POST the page sends, so a test can assert what was saved. */
  function mockScheduleTab(options: {
    schedule: unknown[];
    classSubjects?: (typeof math)[];
    warnings?: string[];
  }) {
    const sent = { patches: [] as unknown[], posts: [] as unknown[] };
    const subjects = options.classSubjects ?? [math];
    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(exam)),
      http.get('/api/v1/exams/:examId/marks/progress', () =>
        HttpResponse.json({ counts: { DRAFT: 0, SUBMITTED: 0 }, outstanding: [] }),
      ),
      http.get('/api/v1/classes/:classId/subjects', () =>
        HttpResponse.json(
          subjects.map((subject) =>
            classSubjectFactory({
              class: klass,
              class_id: klass.id,
              subject,
              subject_id: subject.id,
            }),
          ),
        ),
      ),
      http.get('/api/v1/exams/:examId/schedule', () => HttpResponse.json(options.schedule)),
      http.patch('/api/v1/exams/:examId/schedule/:id', async ({ request }) => {
        sent.patches.push(await request.json());
        return HttpResponse.json({ schedule: scheduleRow(), warnings: options.warnings ?? [] });
      }),
      http.post('/api/v1/exams/:examId/schedule', async ({ request }) => {
        sent.posts.push(await request.json());
        return HttpResponse.json({ schedule: scheduleRow(), warnings: options.warnings ?? [] });
      }),
    );
    return sent;
  }

  function renderScheduleTab() {
    renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=schedule'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
  }

  it('breaks a same-date tie by start time, and names rows that arrive without a subject', async () => {
    mockScheduleTab({
      classSubjects: [math, english],
      schedule: [
        scheduleRow({ id: 'a', starts_at: '13:00:00' }),
        // No embedded subject — the name comes from the class's subject list.
        scheduleRow({ id: 'b', subject: null, subject_id: english.id, starts_at: '09:00:00' }),
        // No embedded subject and not a class subject — the raw id is shown.
        scheduleRow({ id: 'c', subject: null, subject_id: 'subject-gone', date: '2026-02-06' }),
      ],
    });
    renderScheduleTab();

    await screen.findByText('Mathematics');
    const rows = screen.getAllByRole('row');
    within(rows[1]!).getByText('English'); // 2026-02-05 09:00
    within(rows[2]!).getByText('Mathematics'); // 2026-02-05 13:00
    within(rows[3]!).getByText('subject-gone'); // 2026-02-06
  });

  it('Escape closes the editor without saving', async () => {
    const user = userEvent.setup();
    const sent = mockScheduleTab({ schedule: [scheduleRow()] });
    renderScheduleTab();

    await user.click(await screen.findByRole('button', { name: 'Main Hall' }));
    await user.type(screen.getByLabelText('Venue'), ' Annex');
    await user.keyboard('{Escape}');

    // Back to display mode with the original value, and nothing was sent.
    expect(screen.queryByLabelText('Venue')).toBeNull();
    expect(screen.getByRole('button', { name: 'Main Hall' })).toBeTruthy();
    expect(sent.patches).toEqual([]);
  });

  it('shows "—" for an empty venue and saves a blank venue as null, not ""', async () => {
    const user = userEvent.setup();
    const sent = mockScheduleTab({ schedule: [scheduleRow({ venue: null })] });
    renderScheduleTab();

    await user.click(await screen.findByRole('button', { name: '—' }));
    const input = screen.getByLabelText<HTMLInputElement>('Venue');
    expect(input.value).toBe('');

    await user.type(input, '   ');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(sent.patches).toEqual([{ venue: null }]));
  });

  it('edits the date with a date input and times with a time input', async () => {
    const user = userEvent.setup();
    const sent = mockScheduleTab({ schedule: [scheduleRow()] });
    renderScheduleTab();

    await user.click(await screen.findByRole('button', { name: '2026-02-05' }));
    expect(screen.getByLabelText('Date').getAttribute('type')).toBe('date');
    await user.keyboard('{Enter}');
    // A non-venue column is sent as-is (never turned into null).
    await waitFor(() => expect(sent.patches).toEqual([{ date: '2026-02-05' }]));

    await user.click(await screen.findByRole('button', { name: '09:00:00' }));
    expect(screen.getByLabelText('Starts at').getAttribute('type')).toBe('time');
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: '11:00:00' }));
    expect(screen.getByLabelText('Ends at').getAttribute('type')).toBe('time');
  });

  it('shows the warnings the server returns after a save', async () => {
    const user = userEvent.setup();
    mockScheduleTab({
      schedule: [scheduleRow()],
      warnings: ['Mathematics overlaps another exam on 2026-02-05'],
    });
    renderScheduleTab();

    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Main Hall' }));
    await user.keyboard('{Enter}');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Mathematics overlaps another exam on 2026-02-05');
  });

  it('ignores keys other than Enter on a cell, and Enter on a second cell while one is open', async () => {
    const user = userEvent.setup();
    mockScheduleTab({ schedule: [scheduleRow()] });
    renderScheduleTab();

    const venueButton = await screen.findByRole('button', { name: 'Main Hall' });
    venueButton.focus();
    await user.keyboard('a');
    expect(screen.queryByRole('textbox')).toBeNull();

    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Venue')).toBeTruthy();

    // Only one cell can be edited at a time.
    fireEvent.keyDown(screen.getByRole('button', { name: '2026-02-05' }), { key: 'Enter' });
    expect(screen.queryByLabelText('Date')).toBeNull();
    expect(screen.getByLabelText('Venue')).toBeTruthy();
  });

  it('shows an error state when the schedule fails to load', async () => {
    mockScheduleTab({ schedule: [] });
    server.use(
      http.get('/api/v1/exams/:examId/schedule', () =>
        HttpResponse.json(apiErrorBody(404, 'Not found', '/api/v1/exams/exam-1/schedule'), {
          status: 404,
        }),
      ),
    );
    renderScheduleTab();

    expect(await screen.findByText("Couldn't load the schedule.")).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows an empty state, then adds an unscheduled subject with default times', async () => {
    const user = userEvent.setup();
    const sent = mockScheduleTab({
      schedule: [],
      classSubjects: [math],
      warnings: ['Mathematics has no venue yet'],
    });
    renderScheduleTab();

    expect(await screen.findByText('No subjects scheduled yet.')).toBeTruthy();
    const addButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Add' });
    expect(addButton.disabled).toBe(true);

    await user.click(screen.getByRole('combobox', { name: 'Subject' }));
    await user.click(await screen.findByRole('option', { name: 'Mathematics' }));
    expect(addButton.disabled).toBe(false);
    await user.click(addButton);

    await waitFor(() => expect(sent.posts).toHaveLength(1));
    expect(sent.posts[0]).toEqual({
      subject_id: 'subject-math',
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      starts_at: '09:00',
      ends_at: '11:00',
    });
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Mathematics has no venue yet',
    );
    // The picker resets after a successful add.
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(true),
    );
  });
});
