import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

// A fixed calendar date (e.g. '2026-09-10') would stop being "in the
// future" the day the test suite outlives it. 30 days out is always
// safely ahead of whenever this actually runs.
function futureDateIso(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().slice(0, 10);
}

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

  // [9.7]
  function outsideWindowBody() {
    return registerBody({
      editable: false,
      reason_required: true,
      policy: { late_after: '09:00', correction_window_days: 3, allow_future_dates: false },
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
          correction_count: 2,
        },
        {
          student_id: 'student-2',
          roll_number: 2,
          full_name: 'Nusrat Jahan',
          record_id: 'record-2',
          status: 'PRESENT',
          minutes_late: null,
          remarks: null,
          source: 'TEACHER',
          correction_count: 0,
        },
      ],
    });
  }

  it('[9.7] a TEACHER (no ATTENDANCE_CORRECT) gets History-only rows and the "ask an administrator" line', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(outsideWindowBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByText('Rafi Ahmed');
    expect(
      screen.getByText('This register is older than 3 days. Ask an administrator to correct it.'),
    ).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /More actions for/ })[0]!);
    expect(screen.queryByRole('menuitem', { name: 'Correct' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'History' })).toBeTruthy();
  });

  it('[9.7] an ADMIN (holds ATTENDANCE_CORRECT) gets a Correct option on an outside-window row', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(outsideWindowBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Rafi Ahmed');
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /More actions for/ })[0]!);
    expect(screen.getByRole('menuitem', { name: 'Correct' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'History' })).toBeTruthy();

    await user.click(screen.getByRole('menuitem', { name: 'Correct' }));
    expect(await screen.findByRole('heading', { name: 'Correct attendance' })).toBeTruthy();
  });

  it('[9.7] a row with correction_count > 0 gets an "Edited" badge', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(outsideWindowBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Rafi Ahmed');
    // Only Rafi Ahmed's row (correction_count: 2) carries the badge.
    expect(screen.getAllByText('Edited')).toHaveLength(1);
  });

  it('[9.7] a future date under allow_future_dates only offers LEAVE', async () => {
    const date = futureDateIso();
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(
          registerBody({
            session: {
              id: null,
              date,
              period_no: null,
              state: 'DRAFT',
              version: 0,
              marked_by_user_id: null,
              marked_at: null,
              finalized_at: null,
            },
            policy: { late_after: '09:00', correction_window_days: 3, allow_future_dates: true },
          }),
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [`/attendance/section-1?date=${date}`],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByText('Rafi Ahmed');
    const user = userEvent.setup();
    // The compact row tap only ever sets PRESENT/ABSENT directly — the
    // popover is what exposes the full allowed-status list to assert on.
    await user.click(screen.getByLabelText(/Rafi Ahmed, currently/));
    const popover = screen.getByRole('dialog', {
      name: 'Change attendance status for Rafi Ahmed',
    });
    expect(within(popover).getByRole('button', { name: 'Leave' })).toBeTruthy();
    expect(within(popover).queryByRole('button', { name: 'Present' })).toBeNull();
    expect(within(popover).queryByRole('button', { name: 'Absent' })).toBeNull();
    expect(within(popover).queryByRole('button', { name: 'Late' })).toBeNull();

    // [review] The popover only limits its own options — row-click and
    // the keyboard shortcuts are a second path to the same mutation and
    // must be rejected independently, not just hidden from the UI.
    await user.keyboard('{Escape}');
    // The row button (rendered before `AttendanceStatusControl`'s own
    // trigger, which also has "Rafi Ahmed" in its accessible name).
    const rowButtons = screen.getAllByRole('button', { name: /Rafi Ahmed/ });
    const rowButton = rowButtons[0];
    if (!rowButton) throw new Error('expected the row button to be present');
    const stillUnmarked = () =>
      screen.getByLabelText('Rafi Ahmed, currently Unmarked. Change status');

    await user.click(rowButton);
    expect(stillUnmarked()).toBeTruthy();

    await user.keyboard('p');
    expect(stillUnmarked()).toBeTruthy();

    await user.keyboard('{Shift>}p{/Shift}');
    expect(stillUnmarked()).toBeTruthy();
  });
});
