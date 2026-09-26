import { getNotifications } from '@biddaloy/ui/api';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
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
  renderWithRouter(routeTree, {
    initialEntries: ['/exams/seat-plans'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });

  await user.click(await screen.findByRole('button', { name: 'Generate seat plan' }));
  await user.type(await screen.findByLabelText('Plan name'), 'Term 1 Seating');
  await user.click(screen.getByRole('combobox', { name: 'Exam' }));
  await user.click(await screen.findByRole('option', { name: EXAM.name }));
  await user.click(await screen.findByRole('checkbox', { name: /Mathematics/ }));
}

describe('GenerateSeatPlanModal', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('generates a plan successfully', async () => {
    const user = userEvent.setup();
    mockBaseline();
    server.use(
      http.post('/api/v1/seat-plans/generate', () =>
        HttpResponse.json({
          plan: { id: 'plan-1', name: 'Term 1 Seating', status: 'DRAFT' },
          conflicts: [],
        }),
      ),
    );

    await openModalAndPickBasics(user);
    await user.click(await screen.findByRole('checkbox', { name: /101/ }));
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(getNotifications()[0]?.message).toBe('Seat plan generated.');
  });

  it('shows the shortfall and suggested rooms, and retry with the added room succeeds', async () => {
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
                suggested_rooms: [{ room_id: ROOM_B.id, capacity: ROOM_B.capacity }],
              },
            },
            { status: 400 },
          );
        }
        return HttpResponse.json({
          plan: { id: 'plan-1', name: 'Term 1 Seating', status: 'DRAFT' },
          conflicts: [],
        });
      }),
    );

    await openModalAndPickBasics(user);
    await user.click(await screen.findByRole('checkbox', { name: /101/ }));
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await screen.findByText(/Not enough seats/);
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(getNotifications()[0]?.message).toBe('Seat plan generated.');
    expect(attempt).toBe(2);
  });
});
