import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const ROOM_A = { id: 'room-a', building: 'Main', room_no: '101', capacity: 12 };
const ROOM_B = { id: 'room-b', building: 'Main', room_no: '102', capacity: 1 };

const base = {
  exam_schedule_id: 'schedule-1',
  subject_name: 'Mathematics',
  subject_name_bn: null,
  exam_date: '2026-02-01',
  starts_at: '09:00:00',
  ends_at: '11:00:00',
};
const ALLOCATION_1 = {
  ...base,
  id: 'alloc-1',
  student_id: 'student-1',
  student_name: 'Rahim Uddin',
  roll_number: 1,
  section_name: 'A',
  room_id: ROOM_A.id,
  seat_number: '1',
};
const ALLOCATION_2 = {
  ...base,
  id: 'alloc-2',
  student_id: 'student-2',
  student_name: 'Karim Sheikh',
  roll_number: 2,
  section_name: 'A',
  room_id: ROOM_A.id,
  seat_number: '2',
};
const ALLOCATION_3 = {
  ...base,
  id: 'alloc-3',
  student_id: 'student-3',
  student_name: 'Nasrin Akter',
  roll_number: 3,
  section_name: 'B',
  room_id: ROOM_B.id,
  seat_number: '1',
};

function plan(
  overrides: Partial<{
    status: 'DRAFT' | 'PUBLISHED';
    roomA: unknown[];
    invigilator: string | null;
  }> = {},
) {
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
        invigilator_user_id: overrides.invigilator ? 'user-1' : null,
        invigilator_name: overrides.invigilator ?? null,
        allocations: overrides.roomA ?? [ALLOCATION_1, ALLOCATION_2],
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

function renderDetail(search = '') {
  return renderWithRouter(routeTree, {
    initialEntries: [`/exams/seat-plans/plan-1${search}`],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

const filled = () =>
  screen.getAllByRole('button').filter((b) => b.getAttribute('data-variant') === 'default');

async function openReseat(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Change seat — Rahim Uddin' }));
  await user.click(screen.getByRole('combobox', { name: 'Room' }));
  await user.click(await screen.findByRole('option', { name: /102/ }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
}

describe('SeatPlanDetail', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('has no back link, a status badge and four facts in tenant numerals', async () => {
    mockBaseline();
    renderDetail();

    await screen.findByRole('heading', { name: 'Term 1 Seating' });
    expect(screen.queryByText('Back to seat plans')).toBeNull();
    expect(screen.getByText('Draft')).toBeTruthy();
    const fact = (label: string) =>
      screen.getAllByText(label).find((el) => el.tagName === 'DT')?.nextElementSibling?.textContent;
    expect(fact('Exam subjects')).toBe('১');
    expect(fact('Rooms')).toBe('২');
    expect(fact('Students')).toBe('৩');
    expect(fact('Seat order')).toBe('In order');
  });

  it('a DRAFT plan has exactly one filled button, Publish', async () => {
    mockBaseline();
    renderDetail();
    await screen.findByRole('button', { name: 'Publish seat plan' });
    const buttons = filled();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe('Publish seat plan');
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
    await openReseat(user);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it.each([
    [409, 'SEAT_ALREADY_TAKEN', 'Someone already sits in this seat.'],
    [400, 'SEAT_CAPACITY_SHORTFALL', 'This room has no free seat.'],
  ])(
    'a %i %s reseat failure shows a translated line, not the server text',
    async (status, code, message) => {
      const user = userEvent.setup();
      mockBaseline();
      server.use(
        http.patch(
          '/api/v1/seat-plans/:id/allocations/:allocationId',
          () =>
            HttpResponse.json(
              {
                ...apiErrorBody(status, 'Raw server message', '/api/v1/seat-plans/plan-1'),
                details: { code },
              },
              { status },
            ),
          { once: true },
        ),
      );
      renderDetail();
      await openReseat(user);

      await screen.findByText(message);
      expect(screen.queryByText('Raw server message')).toBeNull();
      // Dialog stays open on error — the student was not moved.
      expect(screen.getByRole('dialog')).not.toBeNull();
    },
  );

  it('asks before reseating a room, and only then calls the API', async () => {
    const user = userEvent.setup();
    mockBaseline();
    let called = 0;
    server.use(
      http.post('/api/v1/seat-plans/:id/rooms/:roomId/reshuffle', () => {
        called += 1;
        return HttpResponse.json(plan());
      }),
    );
    renderDetail();

    const buttons = await screen.findAllByRole('button', { name: 'Reseat this room' });
    await user.click(buttons[0]!);
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Reseat this room?')).toBeTruthy();
    expect(called).toBe(0);

    await user.click(within(confirm).getByRole('button', { name: 'Reseat' }));
    await waitFor(() => expect(called).toBe(1));
  });

  it('seats sort numerically: 2 before 10', async () => {
    mockBaseline(
      plan({
        roomA: [
          { ...ALLOCATION_1, id: 'a10', student_name: 'Ten', seat_number: '10' },
          { ...ALLOCATION_2, id: 'a2', student_name: 'Two', seat_number: '2' },
        ],
      }),
    );
    renderDetail();
    await screen.findByText('Ten');
    const names = screen
      .getAllByRole('row')
      .map((row) => row.textContent ?? '')
      .filter((text) => /Ten|Two/.test(text));
    expect(names[0]).toContain('Two');
    expect(names[1]).toContain('Ten');
  });

  it('shows one sitting at a time and switches through ?sitting=', async () => {
    const user = userEvent.setup();
    const english = {
      ...ALLOCATION_1,
      id: 'alloc-eng',
      exam_schedule_id: 'schedule-2',
      subject_name: 'English',
      student_name: 'English Only Student',
    };
    mockBaseline(plan({ roomA: [ALLOCATION_1, ALLOCATION_2, english] }));
    const view = renderDetail();

    // Sittings are sorted by label, so English comes first and Mathematics is hidden.
    await screen.findByText('English Only Student');
    expect(screen.queryByText('Rahim Uddin')).toBeNull();
    const picker = screen.getByRole('combobox', { name: 'Show seats for' });
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: /Mathematics/ }));
    await waitFor(() =>
      expect(view.router.state.location.search).toMatchObject({ sitting: 'schedule-1' }),
    );
    expect(await screen.findByText('Karim Sheikh')).toBeTruthy();
    expect(screen.queryByText('English Only Student')).toBeNull();
  });

  it('PUBLISHED hides every edit control and shows the invigilator as text', async () => {
    mockBaseline(plan({ status: 'PUBLISHED', invigilator: 'Hasan Ali' }));
    renderDetail();

    await screen.findByRole('heading', { name: 'Term 1 Seating' });
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('This seat plan is published');
    expect(screen.queryByRole('button', { name: 'Publish seat plan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reseat this room' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Change seat/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Invigilator' })).toBeNull();
    expect(screen.getByText('Hasan Ali')).toBeTruthy();
  });

  it('a failed publish shows the translated message', async () => {
    const user = userEvent.setup();
    mockBaseline();
    server.use(
      http.post('/api/v1/seat-plans/:id/publish', () =>
        HttpResponse.json(apiErrorBody(500, 'db exploded', '/api/v1/seat-plans/plan-1/publish'), {
          status: 500,
        }),
      ),
    );
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Publish seat plan' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Publish' }));

    expect(await screen.findByText(/Couldn't publish the seat plan\./)).toBeTruthy();
    expect(screen.queryByText(/db exploded/)).toBeNull();
  });
});
