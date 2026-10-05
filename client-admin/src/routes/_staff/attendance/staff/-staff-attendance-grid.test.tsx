import { AttendanceStatus } from '@biddaloy/shared';
import type { StaffUser } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, userResponseFactory } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { StaffAttendanceGrid } from './-staff-attendance-grid';

afterEach(async () => {
  await cleanupTestState();
});

function staffWithProfile(overrides: Partial<StaffUser> & { staff_profile_id: string }): StaffUser {
  return { ...userResponseFactory(overrides), ...overrides };
}

describe('StaffAttendanceGrid', () => {
  it('Enter marks the focused row PRESENT, `l` marks it LEAVE', async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    const staff = [
      staffWithProfile({ id: 'user-1', staff_profile_id: 'profile-1', full_name: 'Karim' }),
      staffWithProfile({ id: 'user-2', staff_profile_id: 'profile-2', full_name: 'Rahima' }),
    ];

    const { localeReady } = renderWithProviders(
      <StaffAttendanceGrid staff={staff} draft={{}} onStatusChange={onStatusChange} />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await localeReady;

    const karimButton = await screen.findByRole('button', { name: 'Karim' });
    karimButton.focus();
    await user.keyboard('{Enter}');
    expect(onStatusChange).toHaveBeenCalledWith('profile-1', AttendanceStatus.PRESENT);

    await user.keyboard('l');
    expect(onStatusChange).toHaveBeenCalledWith('profile-1', AttendanceStatus.LEAVE);
  });

  it('Tab moves focus across rows in DOM order (native tab order, no roving tabindex)', async () => {
    const user = userEvent.setup();
    const staff = [
      staffWithProfile({ id: 'user-1', staff_profile_id: 'profile-1', full_name: 'Karim' }),
      staffWithProfile({ id: 'user-2', staff_profile_id: 'profile-2', full_name: 'Rahima' }),
    ];

    const { localeReady } = renderWithProviders(
      <StaffAttendanceGrid staff={staff} draft={{}} onStatusChange={vi.fn()} />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await localeReady;

    const karimButton = await screen.findByRole('button', { name: 'Karim' });
    karimButton.focus();
    expect(document.activeElement).toBe(karimButton);
    await user.tab();
    expect(document.activeElement).not.toBe(karimButton);
  });

  it('a name click toggles unmarked -> PRESENT and PRESENT -> ABSENT, and the name button is named by the full name only', async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    const staff = [
      staffWithProfile({
        id: 'user-1',
        staff_profile_id: 'profile-1',
        full_name: 'Karim',
        role: 'TEACHER',
      }),
    ];

    const view = renderWithProviders(
      <StaffAttendanceGrid staff={staff} draft={{}} onStatusChange={onStatusChange} />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await view.localeReady;

    await user.click(await screen.findByRole('button', { name: 'Karim' }));
    expect(onStatusChange).toHaveBeenLastCalledWith('profile-1', AttendanceStatus.PRESENT);

    view.rerender(
      <StaffAttendanceGrid
        staff={staff}
        draft={{ 'profile-1': AttendanceStatus.PRESENT }}
        onStatusChange={onStatusChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Karim' }));
    expect(onStatusChange).toHaveBeenLastCalledWith('profile-1', AttendanceStatus.ABSENT);
  });

  it('Enter marks PRESENT without also toggling through the click', async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    const staff = [
      staffWithProfile({ id: 'user-1', staff_profile_id: 'profile-1', full_name: 'Karim' }),
    ];
    const { localeReady } = renderWithProviders(
      <StaffAttendanceGrid
        staff={staff}
        draft={{ 'profile-1': AttendanceStatus.PRESENT }}
        onStatusChange={onStatusChange}
      />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await localeReady;

    (await screen.findByRole('button', { name: 'Karim' })).focus();
    await user.keyboard('{Enter}');

    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith('profile-1', AttendanceStatus.PRESENT);
  });

  it('shows the role caption under the name and counts that follow the draft', async () => {
    const staff = [
      staffWithProfile({
        id: 'user-1',
        staff_profile_id: 'profile-1',
        full_name: 'Karim',
        role: 'TEACHER',
      }),
      staffWithProfile({
        id: 'user-2',
        staff_profile_id: 'profile-2',
        full_name: 'Rahima',
        role: 'TEACHER',
      }),
    ];
    // The role caption reads the `staff` namespace, which the route loader normally loads.
    await loadRouteNamespaces('staff');
    const { localeReady } = renderWithProviders(
      <StaffAttendanceGrid
        staff={staff}
        draft={{ 'profile-1': AttendanceStatus.LEAVE }}
        onStatusChange={vi.fn()}
      />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await localeReady;

    expect((await screen.findAllByText('Teacher')).length).toBe(2);
    expect(screen.getByText('Leave 1')).toBeTruthy();
    expect(screen.getByText('Unmarked 1')).toBeTruthy();
    expect(screen.getByText('Present 0')).toBeTruthy();
  });

  it('skips a user with no staff profile id (never crashes, never renders a row for them)', async () => {
    const staff = [
      staffWithProfile({ id: 'user-1', staff_profile_id: 'profile-1', full_name: 'Karim' }),
      { ...userResponseFactory({ id: 'user-2', full_name: 'No Profile' }) },
    ] as StaffUser[];

    const { localeReady } = renderWithProviders(
      <StaffAttendanceGrid staff={staff} draft={{}} onStatusChange={vi.fn()} />,
      { locale: 'en', tenantId: 'tenant-1' },
    );
    await localeReady;

    expect(await screen.findByRole('button', { name: 'Karim' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'No Profile' })).toBeNull();
  });
});
