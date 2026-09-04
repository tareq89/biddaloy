import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

function registerBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    section: { id: 'section-1', section_name: 'A', class_name: 'Class 5' },
    session: {
      id: null,
      date: '2026-09-04',
      period_no: null,
      state: 'DRAFT',
      version: 0,
      marked_by_user_id: null,
      marked_at: null,
      finalized_at: null,
    },
    editable: true,
    reason_required: false,
    non_working_day: false,
    policy: { late_after: '09:00', correction_window_days: 3, allow_future_dates: false },
    students: [
      {
        student_id: 'student-1',
        roll_number: 1,
        full_name: 'Rafi Ahmed',
        record_id: null,
        status: null,
        minutes_late: null,
        remarks: null,
        source: null,
        correction_count: 0,
      },
      {
        student_id: 'student-2',
        roll_number: 2,
        full_name: 'Nusrat Jahan',
        record_id: null,
        status: null,
        minutes_late: null,
        remarks: null,
        source: null,
        correction_count: 0,
      },
    ],
    ...overrides,
  };
}

describe('/attendance/$sectionId', () => {
  afterEach(async () => {
    await cleanupTestState();
    window.localStorage.clear();
  });

  it('renders the roster and toggles PRESENT/ABSENT on row click', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(registerBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const row = await screen.findByText('Rafi Ahmed');
    const user = userEvent.setup();
    await user.click(row);

    expect(await screen.findByText(/Present 1 ·/)).toBeTruthy();

    await user.click(row);
    expect(await screen.findByText(/Absent 1 ·/)).toBeTruthy();
  });

  it('ArrowDown moves roving focus to the next row', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(registerBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const firstRow = await screen.findByText('Rafi Ahmed');
    const secondRow = screen.getByText('Nusrat Jahan');
    const firstButton = firstRow.closest('button') as HTMLButtonElement;
    const secondButton = secondRow.closest('button') as HTMLButtonElement;

    firstButton.focus();
    const user = userEvent.setup();
    await user.keyboard('{ArrowDown}');

    await waitFor(() => expect(document.activeElement).toBe(secondButton));
  });

  it('shows the confirm-unmarked dialog before submitting with unmarked students', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(registerBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByText('Rafi Ahmed');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Submit register' }));

    expect(await screen.findByText('2 students unmarked')).toBeTruthy();
  });

  it('409 conflict opens the conflict dialog with keep-mine/take-theirs', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(registerBody()),
      ),
      http.put('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'This register changed since you last loaded it',
            timestamp: new Date().toISOString(),
            path: '/attendance/sections/section-1/register',
            requestId: 'req-1',
            details: {
              code: 'ATTENDANCE_VERSION_CONFLICT',
              current_version: 1,
              register: registerBody({
                session: {
                  id: 'session-1',
                  date: '2026-09-04',
                  period_no: null,
                  state: 'DRAFT',
                  version: 1,
                  marked_by_user_id: 'user-2',
                  marked_at: '2026-09-04T00:00:00.000Z',
                  finalized_at: null,
                },
                students: [
                  {
                    student_id: 'student-1',
                    roll_number: 1,
                    full_name: 'Rafi Ahmed',
                    record_id: 'record-1',
                    status: 'ABSENT',
                    minutes_late: null,
                    remarks: null,
                    source: 'TEACHER',
                    correction_count: 0,
                  },
                  {
                    student_id: 'student-2',
                    roll_number: 2,
                    full_name: 'Nusrat Jahan',
                    record_id: null,
                    status: null,
                    minutes_late: null,
                    remarks: null,
                    source: null,
                    correction_count: 0,
                  },
                ],
              }),
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const row = await screen.findByText('Rafi Ahmed');
    const user = userEvent.setup();
    await user.click(row); // marks student-1 PRESENT locally
    await user.click(screen.getByText('Nusrat Jahan')); // marks student-2 PRESENT locally

    expect(await screen.findByText(/Present 2 ·/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Submit register' }));

    expect(
      await screen.findByRole('heading', { name: 'This register changed since you loaded it' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep mine' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take theirs' })).toBeTruthy();
  });
});
