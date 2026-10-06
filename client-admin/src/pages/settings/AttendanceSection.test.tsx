import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttendanceSection } from './AttendanceSection';
import { WithTestRouter } from './with-test-router';

const SERVER_TEXT = 'SERVER_SECRET_TEXT';
const failing = (path: string, method: 'patch' | 'put' | 'post' = 'patch') =>
  http[method](path, () =>
    HttpResponse.json(
      {
        statusCode: 400,
        message: SERVER_TEXT,
        timestamp: new Date().toISOString(),
        path,
        requestId: 'r',
      },
      { status: 400 },
    ),
  );

const SCHOOL_ID = 'school-1';

const ATTENDANCE = {
  weeklyOffDays: [0, 6],
  lateAfter: '09:00',
  absentAfter: '09:30',
  correctionWindowDays: 3,
  lowAttendanceThresholdPercent: 75,
  lateCountsAsPresent: true,
  leaveCountsAsWorkingDay: true,
  allowFutureDates: false,
  percentageDenominator: 'WORKING_DAYS' as const,
  autoAbsentNotification: { enabled: false, cutoffTime: '10:00' },
};

// No jest-dom in this repo's test setup — a plain `.value` read instead of
// `toHaveValue()`, and Radix's `role="checkbox"` `aria-checked` attribute
// instead of `toBeChecked()` (same reasoning `students/new.test.tsx`'s own
// comment documents for `toHaveFocus()`).
function inputValue(element: HTMLElement): string {
  return (element as HTMLInputElement).value;
}

function isChecked(element: HTMLElement): boolean {
  return element.getAttribute('aria-checked') === 'true';
}

describe('AttendanceSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the current values', async () => {
    renderWithProviders(
      <WithTestRouter>
        <AttendanceSection schoolId={SCHOOL_ID} attendance={ATTENDANCE} />
      </WithTestRouter>,
      {
        locale: 'en',
        role: 'ADMIN',
        tenantId: SCHOOL_ID,
      },
    );

    expect(inputValue(await screen.findByLabelText('Late after'))).toBe('9:00 AM');
    expect(inputValue(screen.getByLabelText('Absent after'))).toBe('9:30 AM');
    expect(inputValue(screen.getByLabelText('Correction window (days)'))).toBe('3');
    expect(inputValue(screen.getByLabelText('Low attendance threshold (%)'))).toBe('75');
    expect(isChecked(screen.getByLabelText('Sun'))).toBe(true);
    expect(isChecked(screen.getByLabelText('Sat'))).toBe(true);
    expect(isChecked(screen.getByLabelText('Mon'))).toBe(false);
  });

  it('sends only the attendance slice in the saved payload', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1 });
      }),
    );

    const { user } = renderWithProviders(
      <WithTestRouter>
        <AttendanceSection schoolId={SCHOOL_ID} attendance={ATTENDANCE} />
      </WithTestRouter>,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    const body = patchBody.mock.calls[0]![0];
    expect(Object.keys(body)).toEqual(['version', 'attendance']);
    expect(body.attendance.weeklyOffDays).toEqual([0, 6]);
    expect(body.attendance.autoAbsentNotification).toEqual({ enabled: false, cutoffTime: '10:00' });
  });

  it('rejects an out-of-range threshold', async () => {
    const { user } = renderWithProviders(
      <WithTestRouter>
        <AttendanceSection schoolId={SCHOOL_ID} attendance={ATTENDANCE} />
      </WithTestRouter>,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const threshold = await screen.findByLabelText('Low attendance threshold (%)');
    await user.clear(threshold);
    await user.type(threshold, '150');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getAllByText('Must be between 0 and 100').length).toBeGreaterThan(0),
    );
  });

  it('requires confirmation before enabling auto-absent notifications', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1 });
      }),
    );

    const { user } = renderWithProviders(
      <WithTestRouter>
        <AttendanceSection schoolId={SCHOOL_ID} attendance={ATTENDANCE} />
      </WithTestRouter>,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const notifyCheckbox = await screen.findByLabelText(
      'Notify guardians automatically when a student is marked absent',
    );
    expect(isChecked(notifyCheckbox)).toBe(false);

    await user.click(notifyCheckbox);

    // Checking it does not flip the checkbox straight away: a confirm dialog opens first (D29).
    expect(isChecked(notifyCheckbox)).toBe(false);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Turn on automatic absence messages?')).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Enabling this sends every absent student's guardian a notification automatically, every school day. Are you sure?",
      ),
    ).toBeTruthy();

    // Cancelling leaves it unchecked.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(isChecked(notifyCheckbox)).toBe(false);

    await user.click(notifyCheckbox);
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Yes, enable it',
      }),
    );
    expect(isChecked(notifyCheckbox)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0].attendance.autoAbsentNotification.enabled).toBe(true);
  });

  it('shows a translated error, never the server text, when the save fails', async () => {
    server.use(failing('/api/v1/schools/:id/settings'));
    const { user } = renderWithProviders(
      <WithTestRouter>
        <AttendanceSection schoolId={SCHOOL_ID} attendance={ATTENDANCE} />
      </WithTestRouter>,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save. Try again.");
    expect(screen.queryByText(SERVER_TEXT)).toBeNull();
  });

  describe('shift times and period switch', () => {
    const SHIFTS = [
      { id: 'sh-1', name: 'Morning' },
      { id: 'sh-2', name: 'Day' },
    ];

    function mockShifts(rows = SHIFTS) {
      server.use(
        http.get('*/routines/shifts', () =>
          HttpResponse.json({
            data: rows,
            total: rows.length,
            page: 1,
            limit: 100,
            totalPages: 1,
          }),
        ),
      );
    }

    function capturePatch() {
      const patchBody = vi.fn();
      server.use(
        http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
          patchBody(await request.json());
          return HttpResponse.json({ version: 1 });
        }),
      );
      return patchBody;
    }

    function renderSection(attendance = ATTENDANCE) {
      return renderWithProviders(
        <WithTestRouter>
          <AttendanceSection schoolId={SCHOOL_ID} attendance={attendance} />
        </WithTestRouter>,
        { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
      );
    }

    it('hides the shift section when the school has no shifts', async () => {
      mockShifts([]);
      renderSection();
      await screen.findByLabelText('Late after');
      expect(screen.queryByText('Times per shift')).toBeNull();
    });

    it('prefills two shift rows from the saved setting and sends only complete rows', async () => {
      mockShifts();
      const patchBody = capturePatch();
      const { user } = renderSection({
        ...ATTENDANCE,
        shiftTimes: [
          { shiftId: 'sh-1', lateAfter: '08:00', absentAfter: '08:30' },
          { shiftId: 'gone', lateAfter: '07:00', absentAfter: '07:30' },
        ],
      } as typeof ATTENDANCE);

      expect(inputValue(await screen.findByLabelText('Morning — Late after'))).toBe('8:00 AM');
      expect(inputValue(screen.getByLabelText('Morning — Absent after'))).toBe('8:30 AM');
      expect(inputValue(screen.getByLabelText('Day — Late after'))).toBe('');

      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(patchBody).toHaveBeenCalled());
      const attendance = patchBody.mock.calls[0]![0].attendance;
      // Day is empty, "gone" no longer exists: only Morning goes out.
      expect(attendance.shiftTimes).toEqual([
        { shiftId: 'sh-1', lateAfter: '08:00', absentAfter: '08:30' },
      ]);
      expect(attendance.periodAttendance).toEqual({ enabled: false });
      expect(attendance.lateAfter).toBe('09:00');
      expect(attendance.weeklyOffDays).toEqual([0, 6]);
    });

    it('blocks save when a row has only one time', async () => {
      mockShifts();
      const patchBody = capturePatch();
      const { user } = renderSection();

      await user.click(await screen.findByLabelText('Day — Late after'));
      await user.click(await screen.findByRole('option', { name: '8:00 AM' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('Fill both times or leave both empty.')).toBeTruthy();
      expect(patchBody).not.toHaveBeenCalled();
    });

    it('sends periodAttendance.enabled when the switch is toggled', async () => {
      mockShifts([]);
      const patchBody = capturePatch();
      const { user } = renderSection();

      await user.click(await screen.findByLabelText('Take attendance in each period'));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(patchBody).toHaveBeenCalled());
      expect(patchBody.mock.calls[0]![0].attendance.periodAttendance).toEqual({ enabled: true });
    });
  });
});
