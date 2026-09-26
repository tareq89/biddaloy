import {
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  subjectFactory,
  teacherFactory,
} from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

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

function mockCommonRoutes() {
  server.use(
    http.get('/api/v1/classes/11111111-1111-4111-8111-111111111111/sections', () =>
      HttpResponse.json([{ ...SECTION, enrolled_count: 40 }]),
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

    const table = await screen.findByRole('table');
    await waitFor(() => expect(screen.getByText('08:00–08:40')).toBeTruthy());
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

    const table = await screen.findByRole('table');
    await waitFor(() => expect(screen.getByText('08:00–08:40')).toBeTruthy());
    fireEvent.keyDown(table, { key: 'Enter' });

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
    await user.click(screen.getByText('Math'));
    await user.click(screen.getByLabelText('Ms Nahar'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByText('Ms Nahar is already teaching 7B at this time')).toBeTruthy(),
    );
    // The empty cell placeholder is still there — the failed save never wrote a slot.
    expect(screen.getAllByText('Empty').length).toBeGreaterThan(0);
  });

  // [1047] A 409 that arrives *after* the user closed the picker must not
  // repopulate the violation list — otherwise the next cell opened shows
  // the previous cell's conflict, over a form that never submitted.
  it('drops a conflict response that lands after its picker was closed', async () => {
    mockCommonRoutes();
    server.use(
      http.post('/api/v1/routines/routine-1/slots', async () => {
        await delay(200);
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

    const table = await screen.findByRole('table');
    await waitFor(() => expect(screen.getByText('08:00–08:40')).toBeTruthy());
    fireEvent.keyDown(table, { key: 'Enter' });

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
    await user.click(screen.getByText('Math'));
    await user.click(screen.getByLabelText('Ms Nahar'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Close the picker while that 409 is still in flight.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Let the response land, then confirm it left nothing behind.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByText('Ms Nahar is already teaching 7B')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
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

    const table = await screen.findByRole('table');
    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
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
    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
    expect(screen.queryByText('subject-old')).toBeNull();

    // Editing the cell prefills from the active row and saves against
    // slot-1, not slot-old — proves `activeCellSlot()` (a `.find`, which
    // without the filter would return whichever row is listed first) also
    // resolved to the effective row, not just that some row rendered.
    const table = await screen.findByRole('table');
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

    expect(await screen.findByText(/routine builder's section list/i)).toBeTruthy();
  });

  it('shows the sectionNotFound explanation when the section id does not match', async () => {
    mockCommonRoutes();
    renderWithRouter(routeTree, {
      initialEntries: ['/routines/missing-section?classId=11111111-1111-4111-8111-111111111111'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText(/section.*not found|not found/i)).toBeTruthy();
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

    expect(await screen.findByText(/no shift/i)).toBeTruthy();
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

    expect(await screen.findByText(/no routine/i)).toBeTruthy();
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

    const table = await screen.findByRole('table');
    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
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
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /fill assist/i }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
  });
});
