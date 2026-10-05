import { getNotifications } from '@biddaloy/ui/api';
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const EXAM = { id: 'exam-1', name: 'Half Yearly 2026', kind: 'TERM', status: 'DRAFT' };
const SCHEDULE = {
  id: 'schedule-1',
  exam_id: EXAM.id,
  subject_id: 'subject-1',
  subject: { id: 'subject-1', name_en: 'Mathematics', name_bn: 'গণিত' },
  date: '2026-02-01',
  starts_at: '09:00',
  ends_at: '11:00',
  venue: null,
};
const ROOM_A = { id: 'room-a', building: 'Main', room_no: '101', capacity: 30 };
const ROOM_B = { id: 'room-b', building: 'Main', room_no: '102', capacity: 20 };

function mockBaseline() {
  server.use(
    http.get('/api/v1/seat-plans', () => HttpResponse.json([])),
    http.get('/api/v1/exams', () =>
      HttpResponse.json({ data: [EXAM], total: 1, page: 1, limit: 100, totalPages: 1 }),
    ),
    http.get('/api/v1/exams/:examId/schedule', () => HttpResponse.json([SCHEDULE])),
    http.get('/api/v1/routines/rooms', () =>
      HttpResponse.json({ data: [ROOM_A, ROOM_B], total: 2, page: 1, limit: 100, totalPages: 1 }),
    ),
  );
}

async function openModalAndPickBasics(user: ReturnType<typeof userEvent.setup>) {
  const view = renderWithRouter(routeTree, {
    initialEntries: ['/exams/seat-plans'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });

  // The empty list also offers the button; the header's comes first.
  const buttons = await screen.findAllByRole('button', { name: 'Generate seat plan' });
  await user.click(buttons[0]!);
  await user.type(await screen.findByLabelText('Plan name'), 'Term 1 Seating');
  await user.click(screen.getByRole('combobox', { name: 'Exam' }));
  await user.click(await screen.findByRole('option', { name: new RegExp(EXAM.name) }));
  await user.click(await screen.findByRole('checkbox', { name: /Mathematics/ }));
  return view;
}

const GENERATED = {
  plan: { id: 'plan-1', name: 'Term 1 Seating', status: 'DRAFT' },
  conflicts: [],
};

describe('GenerateSeatPlanModal (full page)', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('generates a plan and opens it', async () => {
    const user = userEvent.setup();
    mockBaseline();
    server.use(http.post('/api/v1/seat-plans/generate', () => HttpResponse.json(GENERATED)));

    const view = await openModalAndPickBasics(user);
    await user.click(await screen.findByRole('checkbox', { name: /101/ }));
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(view.router.state.location.pathname).toBe('/exams/seat-plans/plan-1'),
    );
    expect(getNotifications()[0]?.message).toBe('Seat plan generated.');
  });

  it('shows a sitting with a long date and 12-hour time, never ISO or seconds', async () => {
    const user = userEvent.setup();
    mockBaseline();
    await openModalAndPickBasics(user);

    const picker = screen.getByTestId('schedule-picker');
    expect(picker.textContent).not.toMatch(/2026-02-01/);
    expect(picker.textContent).not.toMatch(/:00:00/);
    expect(within(picker).getByText(/–/)).toBeTruthy();
  });

  it('Generate stays disabled until a name, a sitting and a room are chosen; rooms show a seat total', async () => {
    const user = userEvent.setup();
    mockBaseline();
    await openModalAndPickBasics(user);

    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Generate' });
    expect(submit.disabled).toBe(true);

    const rooms = screen.getByTestId('room-picker');
    await user.click(await within(rooms).findByRole('checkbox', { name: /101/ }));
    expect(submit.disabled).toBe(false);
    // Bangla numerals are the default tenant region: 30 seats.
    expect(rooms.textContent).toContain('৩০ seats in total');
    await user.click(within(rooms).getByRole('checkbox', { name: /102/ }));
    expect(rooms.textContent).toContain('৫০ seats in total');
  });

  it('shows the shortfall and suggested rooms by label, and retry with the added room succeeds', async () => {
    const user = userEvent.setup();
    mockBaseline();
    let attempt = 0;
    server.use(
      http.post('/api/v1/seat-plans/generate', () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            {
              statusCode: 400,
              message: 'Not enough room capacity for the selected subject sittings',
              timestamp: new Date().toISOString(),
              path: '/api/v1/seat-plans/generate',
              requestId: 'req-1',
              details: {
                code: 'SEAT_CAPACITY_SHORTFALL',
                seats_needed: 40,
                seats_available: 30,
                shortfall: 10,
                suggested_rooms: [
                  { room_id: ROOM_B.id, capacity: ROOM_B.capacity },
                  { room_id: 'room-unknown', capacity: 99 },
                ],
              },
            },
            { status: 400 },
          );
        }
        return HttpResponse.json(GENERATED);
      }),
    );

    const view = await openModalAndPickBasics(user);
    await user.click(await screen.findByRole('checkbox', { name: /101/ }));
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    const alert = await screen.findByText(/Not enough seats/);
    const box = alert.closest('[role=alert]') as HTMLElement;
    expect(within(box).getByText(/Main — 102/)).toBeTruthy();
    // A suggestion whose room is unknown is skipped, never shown as an id.
    expect(within(box).queryByText(/room-unknown/)).toBeNull();
    expect(within(box).getAllByRole('button', { name: 'Add' })).toHaveLength(1);

    await user.click(within(box).getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(view.router.state.location.pathname).toBe('/exams/seat-plans/plan-1'),
    );
    expect(attempt).toBe(2);
  });

  it('a generic failure shows one translated line, not the server text', async () => {
    const user = userEvent.setup();
    mockBaseline();
    server.use(
      http.post('/api/v1/seat-plans/generate', () =>
        HttpResponse.json(apiErrorBody(500, 'db exploded', '/api/v1/seat-plans/generate'), {
          status: 500,
        }),
      ),
    );

    await openModalAndPickBasics(user);
    await user.click(await screen.findByRole('checkbox', { name: /101/ }));
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByText(/db exploded/)).toBeNull();
  });

  it('lists conflicts by room label and plan name, then opens the plan', async () => {
    const user = userEvent.setup();
    mockBaseline();
    server.use(
      http.get('/api/v1/seat-plans', () =>
        HttpResponse.json([
          {
            id: 'plan-0',
            name: 'First Term Seating',
            status: 'PUBLISHED',
            seat_order_mode: 'SEQUENTIAL',
            schedule_count: 1,
            room_count: 1,
            student_count: 10,
          },
        ]),
      ),
      http.post('/api/v1/seat-plans/generate', () =>
        HttpResponse.json({
          ...GENERATED,
          conflicts: [{ room_id: ROOM_A.id, conflicting_seat_plan_id: 'plan-0' }],
        }),
      ),
    );

    const view = await openModalAndPickBasics(user);
    await user.click(await screen.findByRole('checkbox', { name: /101/ }));
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await screen.findByText('Time clash');
    expect(
      screen.getByText(/Main — 101 · also in “First Term Seating” at the same time/),
    ).toBeTruthy();
    expect(screen.queryByText(/room-a|plan-0/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open the plan' }));
    await waitFor(() =>
      expect(view.router.state.location.pathname).toBe('/exams/seat-plans/plan-1'),
    );
  });

  it('Close after typing a name asks before discarding', async () => {
    const user = userEvent.setup();
    mockBaseline();
    await openModalAndPickBasics(user);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });
});
