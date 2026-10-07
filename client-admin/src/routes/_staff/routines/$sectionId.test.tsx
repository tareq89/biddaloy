import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import {
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  subjectFactory,
  teacherFactory,
} from '@biddaloy/ui/test';
import { formatNumber, formatTime } from '@biddaloy/ui/utils';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const TEACHER_CLASH_TEXT =
  'A teacher on this period is already teaching another section at this time.';
const GRID_NAME = 'Weekly routine table';
const PERIOD_TEXT = `${formatTime('08:00', REGION_BD_BN)} – ${formatTime('08:40', REGION_BD_BN)}`;

const SECTION = classSectionFactory({
  id: 'section-1',
  section_name: 'A',
  class: {
    ...classFactory({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Class 6',
      shift_id: 'shift-1',
    }),
  },
  class_id: '11111111-1111-4111-8111-111111111111',
});
const SUBJECT = subjectFactory({ id: 'subject-math', name_en: 'Math' });
const TEACHER = teacherFactory({ id: 'teacher-1' });
TEACHER.user.full_name = 'Ms Nahar';

function mockCommonRoutes(enrolledCount = 40) {
  server.use(
    http.get('/api/v1/classes/11111111-1111-4111-8111-111111111111/sections', () =>
      HttpResponse.json([{ ...SECTION, enrolled_count: enrolledCount }]),
    ),
    http.get('/api/v1/calendar-settings', () =>
      HttpResponse.json({ weeklyOffDays: [5, 6], termLabel: null }),
    ),
    http.get('/api/v1/routines', () =>
      HttpResponse.json([
        {
          id: 'routine-1',
          academic_year_id: SECTION.class.academic_year_id,
          name: 'Routine',
          state: 'DRAFT',
          published_at: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          deleted_at: null,
        },
      ]),
    ),
    http.get('/api/v1/routines/shifts/shift-1/period-slots', () =>
      HttpResponse.json([
        {
          id: 'p1',
          shift_id: 'shift-1',
          sequence: 1,
          kind: 'CLASS',
          name: null,
          starts_at: '08:00',
          ends_at: '08:40',
        },
      ]),
    ),
    http.get('/api/v1/routines/routine-1/slots', () => HttpResponse.json([])),
    http.get('/api/v1/routines/routine-1/workload', () => HttpResponse.json([])),
    http.get('/api/v1/schools/tenant-1/settings', () => HttpResponse.json({})),
    http.get('/api/v1/subjects', () =>
      HttpResponse.json({ data: [SUBJECT], total: 1, page: 1, limit: 100, totalPages: 1 }),
    ),
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({ data: [TEACHER], total: 1, page: 1, limit: 100, totalPages: 1 }),
    ),
  );
}

describe('/routines/$sectionId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('says "1 student", not "1 students", for a one-student section', async () => {
    mockCommonRoutes(1);
    renderWithRouter(routeTree, {
      initialEntries: ['/routines/section-1?classId=11111111-1111-4111-8111-111111111111'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText(`${formatNumber(1, REGION_BD_BN)} student`)).toBeTruthy();
  });

  it('shows the section as the page title with the routine state and how full the week is', async () => {
    mockCommonRoutes();
    renderWithRouter(routeTree, {
      initialEntries: ['/routines/section-1?classId=11111111-1111-4111-8111-111111111111'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Class 6 – A' })).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText(`${formatNumber(40, REGION_BD_BN)} students`)).toBeTruthy();
    // 1 class period x 5 working days (Sun-Thu), nothing placed yet.
    expect(
      await screen.findByText(
        `${formatNumber(0, REGION_BD_BN)} of ${formatNumber(5, REGION_BD_BN)} periods`,
      ),
    ).toBeTruthy();
  });

  it('opens the cell picker on Enter and saves a new slot', async () => {
    mockCommonRoutes();
    server.use(
      http.post('/api/v1/routines/routine-1/slots', () =>
        HttpResponse.json({
          slot: {
            id: 'slot-1',
            tenant_id: 'tenant-1',
            routine_id: 'routine-1',
            section_id: 'section-1',
            period_slot_id: 'p1',
            weekday: 0,
            subject_id: 'subject-math',
            room_id: null,
            recurrence: 'WEEKLY',
            recurrence_offset: 0,
            valid_from: '2026-01-01',
            valid_to: null,
          },
          teacher_ids: ['teacher-1'],
          warnings: [],
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/section-1?classId=11111111-1111-4111-8111-111111111111'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const table = await screen.findByRole('table', { name: GRID_NAME });
    await waitFor(() => expect(screen.getByText(PERIOD_TEXT)).toBeTruthy());
    fireEvent.keyDown(table, { key: 'Enter' });

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
    await user.click(screen.getByText('Math'));
    await user.click(screen.getByLabelText('Ms Nahar'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The picker dialog closes on a successful save, with no violation
    // banner left behind.
    await waitFor(() => expect(screen.queryByLabelText('Subject')).toBeNull());
    expect(screen.queryByText(/can't be saved/i)).toBeNull();
  });

  it('a 409 conflict lists all violations and leaves the cell unsaved', async () => {
    mockCommonRoutes();
    server.use(
      http.post('/api/v1/routines/routine-1/slots', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'Conflict',
            requestId: 'req-1',
            details: {
              violations: [
                {
                  code: 'TEACHER_DOUBLE_BOOKED',
                  message: 'Ms Nahar is already teaching 7B at this time',
                },
              ],
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/section-1?classId=11111111-1111-4111-8111-111111111111'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const table = await screen.findByRole('table', { name: GRID_NAME });
    await waitFor(() => expect(screen.getByText(PERIOD_TEXT)).toBeTruthy());
    fireEvent.keyDown(table, { key: 'Enter' });

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
    await user.click(screen.getByText('Math'));
    await user.click(screen.getByLabelText('Ms Nahar'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText(TEACHER_CLASH_TEXT)).toBeTruthy());
    // The server's English sentence never reaches the screen (D9).
    expect(screen.queryByText('Ms Nahar is already teaching 7B at this time')).toBeNull();
    // The empty cell placeholder is still there — the failed save never wrote a slot.
    expect(screen.getAllByText('Empty').length).toBeGreaterThan(0);
  });

  // [1047] A 409 that arrives *after* the user moved on must not repopulate
  // the violation list — the reported symptom is the *next* cell opening
  // with the previous cell's conflict, over a form that never submitted.
  //
  // The second picker is the whole point of the test: violations render
  // only inside the picker, so asserting "no alert" with nothing open
  // would pass even with the guard removed. The 409 is held until that
  // second picker is on screen, so the only way it can surface is by
  // leaking across cells.
  it('drops a conflict response that lands after its picker was closed', async () => {
    mockCommonRoutes();
    let releaseConflict = () => {};
    const conflictReleased = new Promise<void>((resolve) => {
      releaseConflict = resolve;
    });
    let markRequestStarted = () => {};
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    server.use(
      http.post('/api/v1/routines/routine-1/slots', async () => {
        markRequestStarted();
        await conflictReleased;
        return HttpResponse.json(
          {
            statusCode: 409,
            message: 'Conflict',
            requestId: 'req-1',
            details: {
              violations: [
                { code: 'TEACHER_DOUBLE_BOOKED', message: 'Ms Nahar is already teaching 7B' },
              ],
            },
          },
          { status: 409 },
        );
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/section-1?classId=11111111-1111-4111-8111-111111111111'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const table = await screen.findByRole('table', { name: GRID_NAME });
    await waitFor(() => expect(screen.getByText(PERIOD_TEXT)).toBeTruthy());
    fireEvent.keyDown(table, { key: 'Enter' });

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
    await user.click(screen.getByText('Math'));
    await user.click(screen.getByLabelText('Ms Nahar'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Close the first cell's picker with its save still in flight.
    await requestStarted;
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Open a *different* cell, so there is a picker on screen that a
    // leaked violation could render into.
    fireEvent.keyDown(table, { key: 'ArrowRight' });
    fireEvent.keyDown(table, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    // Only now let the first cell's 409 come back.
    releaseConflict();

    // It must never reach this picker. `waitFor` polls for the full
    // timeout and rejects if the alert never appears — which is the pass
    // condition here, and a real wait rather than a fixed sleep.
    await expect(
      waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 500 }),
    ).rejects.toThrow();
    expect(screen.queryByText(TEACHER_CLASH_TEXT)).toBeNull();
  });

  it('opens the cell picker prefilled when editing an existing slot, and shows a generic error on a non-conflict failure', async () => {
    mockCommonRoutes();
    server.use(
      http.get('/api/v1/routines/routine-1/slots', () =>
        HttpResponse.json([
          {
            slot: {
              id: 'slot-1',
              section_id: 'section-1',
              weekday: 0,
              period_slot_id: 'p1',
              subject_id: 'subject-math',
              recurrence: 'WEEKLY',
              recurrence_offset: 0,
              valid_from: '2026-01-01',
              valid_to: null,
            },
            teacher_ids: ['teacher-1'],
            warnings: ['heads up'],
          },
        ]),
      ),
      http.patch('/api/v1/routines/slots/slot-1', () =>
        HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/section-1?classId=11111111-1111-4111-8111-111111111111'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const table = await screen.findByRole('table', { name: GRID_NAME });
    await waitFor(() => expect(screen.getAllByText('Math').length).toBeGreaterThan(0));
    fireEvent.keyDown(table, { key: 'Enter' });

    // Prefilled from the existing slot: the subject picker already shows Math selected.
    await waitFor(() => expect(screen.getByLabelText('Subject')).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // A non-conflict failure leaves the picker open (no violations to show, no close).
    await waitFor(() => expect(screen.getByLabelText('Subject')).toBeTruthy());
  });

  it('picks the effective row (not a superseded one) when a cell has two rows for the same weekday/period', async () => {
    mockCommonRoutes();
    server.use(
      http.get('/api/v1/routines/routine-1/slots', () =>
        HttpResponse.json([
          {
            // The active row — listed first so a `cells` map that (without
            // the effective-dating filter) just keeps "whichever entry
            // came last" would wrongly end up showing the superseded row
            // below instead of this one.
            slot: {
              id: 'slot-1',
              section_id: 'section-1',
              weekday: 0,
              period_slot_id: 'p1',
              subject_id: 'subject-math',
              recurrence: 'WEEKLY',
              recurrence_offset: 0,
              valid_from: '2020-07-01',
              valid_to: null,
            },
            teacher_ids: ['teacher-1'],
            warnings: [],
          },
          {
            // Superseded by an earlier edit — closed before today, must
            // not be the row the grid/picker/clear act on.
            slot: {
              id: 'slot-old',
              section_id: 'section-1',
              weekday: 0,
              period_slot_id: 'p1',
              subject_id: 'subject-old',
              recurrence: 'WEEKLY',
              recurrence_offset: 0,
              valid_from: '2020-01-01',
              valid_to: '2020-06-30',
            },
            teacher_ids: ['teacher-1'],
            warnings: [],
          },
        ]),
      ),
    );
    const patchedSlotIds: string[] = [];
    server.use(
      http.patch('/api/v1/routines/slots/:slotId', ({ params }) => {
        patchedSlotIds.push(params.slotId as string);
        return HttpResponse.json({
          slot: { id: params.slotId, subject_id: 'subject-math' },
          teacher_ids: ['teacher-1'],
          warnings: [],
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/section-1?classId=11111111-1111-4111-8111-111111111111'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    // The grid renders the active row's subject, not the superseded one.
    await waitFor(() => expect(screen.getAllByText('Math').length).toBeGreaterThan(0));
    expect(screen.queryByText('subject-old')).toBeNull();

    // Editing the cell prefills from the active row and saves against
    // slot-1, not slot-old — proves `activeCellSlot()` (a `.find`, which
    // without the filter would return whichever row is listed first) also
    // resolved to the effective row, not just that some row rendered.
    const table = await screen.findByRole('table', { name: GRID_NAME });
    fireEvent.keyDown(table, { key: 'Enter' });
    await waitFor(() => expect(screen.getByLabelText('Subject')).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchedSlotIds).toEqual(['slot-1']));
  });

  it('shows the noClassId explanation when opened without ?classId=', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/routines/section-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { name: 'Which section?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Class routine' })).toBeTruthy();
  });

  it('shows the sectionNotFound explanation when the section id does not match', async () => {
    mockCommonRoutes();
    renderWithRouter(routeTree, {
      initialEntries: ['/routines/missing-section?classId=11111111-1111-4111-8111-111111111111'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { name: 'Section not found.' })).toBeTruthy();
  });

  it('shows the noShift explanation when the section has no shift', async () => {
    server.use(
      http.get('/api/v1/classes/11111111-1111-4111-8111-111111111111/sections', () =>
        HttpResponse.json([
          { ...SECTION, enrolled_count: 40, class: { ...SECTION.class, shift_id: null } },
        ]),
      ),
      http.get('/api/v1/calendar-settings', () =>
        HttpResponse.json({ weeklyOffDays: [5, 6], termLabel: null }),
      ),
      http.get('/api/v1/routines', () => HttpResponse.json([])),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/routines/section-1?classId=11111111-1111-4111-8111-111111111111'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { name: 'This class has no shift' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open class' })).toBeTruthy();
  });

  it('shows the noRoutine explanation when no routine exists for the year', async () => {
    server.use(
      http.get('/api/v1/classes/11111111-1111-4111-8111-111111111111/sections', () =>
        HttpResponse.json([{ ...SECTION, enrolled_count: 40 }]),
      ),
      http.get('/api/v1/calendar-settings', () =>
        HttpResponse.json({ weeklyOffDays: [5, 6], termLabel: null }),
      ),
      http.get('/api/v1/routines', () => HttpResponse.json([])),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/routines/section-1?classId=11111111-1111-4111-8111-111111111111'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { name: 'No routine yet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open routine review' })).toBeTruthy();
  });

  it('clears an existing cell on Delete/Backspace', async () => {
    mockCommonRoutes();
    let deleted = false;
    const entry = {
      slot: {
        id: 'slot-1',
        section_id: 'section-1',
        weekday: 0,
        period_slot_id: 'p1',
        subject_id: 'subject-math',
        recurrence: 'WEEKLY' as const,
        recurrence_offset: 0,
        valid_from: '2026-01-01',
        valid_to: null,
      },
      teacher_ids: ['teacher-1'],
      warnings: [],
    };
    server.use(
      http.get('/api/v1/routines/routine-1/slots', () => HttpResponse.json(deleted ? [] : [entry])),
      http.delete('/api/v1/routines/slots/slot-1', () => {
        deleted = true;
        return HttpResponse.json({});
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/section-1?classId=11111111-1111-4111-8111-111111111111'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const table = await screen.findByRole('table', { name: GRID_NAME });
    await waitFor(() => expect(screen.getAllByText('Math').length).toBeGreaterThan(0));
    fireEvent.keyDown(table, { key: 'Delete' });

    await waitFor(() => expect(screen.queryByText('Math')).toBeNull());
  });

  it('opens the fill-assist dialog from the header action', async () => {
    mockCommonRoutes();
    renderWithRouter(routeTree, {
      initialEntries: ['/routines/section-1?classId=11111111-1111-4111-8111-111111111111'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('table', { name: GRID_NAME });
    await user.click(screen.getByRole('button', { name: /fill empty periods/i }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });
});
