import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const ROOM_A = { id: 'room-a', building: 'Main', room_no: '101', capacity: 2 };
const ROOM_B = { id: 'room-b', building: 'Main', room_no: '102', capacity: 1 };

const ALLOCATION_1 = {
  id: 'alloc-1',
  exam_schedule_id: 'schedule-1',
  student_id: 'student-1',
  student_name: 'Rahim Uddin',
  roll_number: 1,
  section_name: 'A',
  subject_name: 'Mathematics',
  room_id: ROOM_A.id,
  seat_number: '1',
};
const ALLOCATION_2 = {
  id: 'alloc-2',
  exam_schedule_id: 'schedule-1',
  student_id: 'student-2',
  student_name: 'Karim Sheikh',
  roll_number: 2,
  section_name: 'A',
  subject_name: 'Mathematics',
  room_id: ROOM_A.id,
  seat_number: '2',
};
const ALLOCATION_3 = {
  id: 'alloc-3',
  exam_schedule_id: 'schedule-1',
  student_id: 'student-3',
  student_name: 'Nasrin Akter',
  roll_number: 3,
  section_name: 'B',
  subject_name: 'Mathematics',
  room_id: ROOM_B.id,
  seat_number: '1',
};

function plan(overrides: Partial<{ status: 'DRAFT' | 'PUBLISHED' }> = {}) {
  return {
    id: 'plan-1',
    name: 'Term 1 Seating',
    status: overrides.status ?? 'DRAFT',
    seat_order_mode: 'SEQUENTIAL',
    schedule_count: 1,
    room_count: 2,
    student_count: 3,
    rooms: [
      {
        room_id: ROOM_A.id,
        room_no: ROOM_A.room_no,
        building: ROOM_A.building,
        capacity: ROOM_A.capacity,
        invigilator_user_id: null,
        invigilator_name: null,
        allocations: [ALLOCATION_1, ALLOCATION_2],
      },
      {
        room_id: ROOM_B.id,
        room_no: ROOM_B.room_no,
        building: ROOM_B.building,
        capacity: ROOM_B.capacity,
        invigilator_user_id: null,
        invigilator_name: null,
        allocations: [ALLOCATION_3],
      },
    ],
  };
}

function mockBaseline(planData = plan()) {
  server.use(
    http.get('/api/v1/seat-plans/:id', () => HttpResponse.json(planData)),
    http.get('/api/v1/routines/rooms', () =>
      HttpResponse.json({ data: [ROOM_A, ROOM_B], total: 2, page: 1, limit: 100, totalPages: 1 }),
    ),
    http.get('/api/v1/users', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
    ),
  );
}

function renderDetail() {
  renderWithRouter(routeTree, {
    initialEntries: ['/exams/seat-plans/plan-1'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('SeatPlanDetail', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('reseats a student successfully', async () => {
    const user = userEvent.setup();
    mockBaseline();
    server.use(
      http.patch('/api/v1/seat-plans/:id/allocations/:allocationId', () =>
        HttpResponse.json({ ...ALLOCATION_1, room_id: ROOM_B.id, seat_number: '2' }),
      ),
    );
    renderDetail();

    const reseatButtons = await screen.findAllByRole('button', { name: 'Reseat' });
    await user.click(reseatButtons[0]!);

    await user.click(screen.getByRole('combobox', { name: 'Room' }));
    await user.click(await screen.findByRole('option', { name: /102/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('rejects a capacity-exceeding reseat with a clear error', async () => {
    const user = userEvent.setup();
    mockBaseline();
    server.use(
      http.patch(
        '/api/v1/seat-plans/:id/allocations/:allocationId',
        () =>
          HttpResponse.json(
            {
              statusCode: 400,
              message: 'Target room has no free capacity for this subject sitting',
              timestamp: new Date().toISOString(),
              path: '/api/v1/seat-plans/plan-1/allocations/alloc-1',
              requestId: 'req-1',
              details: { code: 'SEAT_CAPACITY_SHORTFALL', room_id: ROOM_B.id },
            },
            { status: 400 },
          ),
        { once: true },
      ),
    );
    renderDetail();

    const reseatButtons = await screen.findAllByRole('button', { name: 'Reseat' });
    await user.click(reseatButtons[0]!);
    await user.click(screen.getByRole('combobox', { name: 'Room' }));
    await user.click(await screen.findByRole('option', { name: /102/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Target room has no free capacity for this subject sitting');
    // Dialog stays open on error — the student was not moved.
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('reshuffles only the target room', async () => {
    const user = userEvent.setup();
    mockBaseline();
    server.use(
      http.post('/api/v1/seat-plans/:id/rooms/:roomId/reshuffle', () =>
        HttpResponse.json({
          ...plan(),
          rooms: [
            {
              ...plan().rooms[0],
              allocations: [
                { ...ALLOCATION_1, seat_number: '2' },
                { ...ALLOCATION_2, seat_number: '1' },
              ],
            },
            plan().rooms[1],
          ],
        }),
      ),
    );
    renderDetail();

    const reshuffleButtons = await screen.findAllByRole('button', { name: 'Reshuffle this room' });
    await user.click(reshuffleButtons[0]!);

    await waitFor(async () => {
      const rows = await screen.findAllByRole('row');
      expect(rows.some((row) => within(row).queryByText('Rahim Uddin'))).toBe(true);
    });
    // Room B's own seat (untouched by the mocked response) is still there.
    // Both the desktop table and the phone card list render in jsdom (CSS
    // `hidden`/`sm:hidden` doesn't apply without a real viewport), so the
    // name appears twice — `getAllByText` rather than a single-match query.
    expect(screen.getAllByText('Nasrin Akter').length).toBeGreaterThan(0);
  });

  it('locks the screen and hides edit controls once published', async () => {
    mockBaseline(plan({ status: 'PUBLISHED' }));
    renderDetail();

    await screen.findByText('Term 1 Seating');
    expect(screen.getByText('Published')).not.toBeNull();
    for (const button of screen.getAllByRole('button', { name: 'Reseat' })) {
      expect(button.getAttribute('disabled')).not.toBeNull();
    }
    for (const button of screen.getAllByRole('button', { name: 'Reshuffle this room' })) {
      expect(button.getAttribute('disabled')).not.toBeNull();
    }
    expect(
      screen.getByRole('button', { name: 'Publish seat plan' }).getAttribute('disabled'),
    ).not.toBeNull();
  });
});
