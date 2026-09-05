import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttendanceSection } from './AttendanceSection';

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
    renderWithProviders(<AttendanceSection schoolId={SCHOOL_ID} attendance={ATTENDANCE} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect(inputValue(await screen.findByLabelText('Late after'))).toBe('09:00');
    expect(inputValue(screen.getByLabelText('Absent after'))).toBe('09:30');
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
      <AttendanceSection schoolId={SCHOOL_ID} attendance={ATTENDANCE} />,
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
      <AttendanceSection schoolId={SCHOOL_ID} attendance={ATTENDANCE} />,
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
      <AttendanceSection schoolId={SCHOOL_ID} attendance={ATTENDANCE} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const notifyCheckbox = await screen.findByLabelText(
      'Notify guardians automatically when a student is marked absent',
    );
    expect(isChecked(notifyCheckbox)).toBe(false);

    await user.click(notifyCheckbox);

    // Checking it does not flip the checkbox straight away — a confirm
    // panel appears first, same as `-year-form-dialog.tsx`'s `is_current`.
    expect(isChecked(notifyCheckbox)).toBe(false);
    await screen.findByText(
      "Enabling this sends every absent student's guardian a notification automatically, every school day. Are you sure?",
    );

    await user.click(screen.getByRole('button', { name: 'Yes, enable it' }));
    expect(isChecked(notifyCheckbox)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0].attendance.autoAbsentNotification.enabled).toBe(true);
  });
});
