import { UserRole } from '@biddaloy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getActiveTenant } from '../api/auth-state';
import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { UserMenu } from './user-menu';

afterEach(async () => {
  await cleanupTestState();
});

describe('UserMenu', () => {
  it('shows the loaded name and role, and is axe clean', async () => {
    const { baseElement, user } = renderWithProviders(
      <UserMenu name="Rahim Uddin" roleLabel="Accountant" onSignOut={vi.fn()} />,
      { locale: 'en' },
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /Account menu/ })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Account menu/ }));

    expect(await screen.findByText('Rahim Uddin')).toBeTruthy();
    expect(screen.getByText('Accountant')).toBeTruthy();
    await expect(baseElement).toHaveNoViolations();
  });

  it('shows a loading fallback for the name while /users/me is in flight, but Sign out still works', async () => {
    const onSignOut = vi.fn();
    const { user } = renderWithProviders(
      <UserMenu name={undefined} roleLabel="Accountant" onSignOut={onSignOut} />,
      { locale: 'en' },
    );

    await user.click(screen.getByRole('button', { name: 'Account menu' }));

    expect(await screen.findByText('Loading…')).toBeTruthy();

    await user.click(screen.getByRole('menuitem', { name: /Sign out/ }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('renders the profileItem slot between the identity block and Sign out', async () => {
    const { user } = renderWithProviders(
      <UserMenu
        name="Rahim Uddin"
        roleLabel="Accountant"
        onSignOut={vi.fn()}
        profileItem={<div role="menuitem">Profile</div>}
      />,
      { locale: 'en' },
    );

    await user.click(screen.getByRole('button', { name: /Account menu/ }));

    expect(await screen.findByRole('menuitem', { name: 'Profile' })).toBeTruthy();
  });

  it('renders the installItem slot between the identity block and Sign out', async () => {
    const { user } = renderWithProviders(
      <UserMenu
        name="Rahim Uddin"
        roleLabel="Accountant"
        onSignOut={vi.fn()}
        installItem={<div role="menuitem">Install app</div>}
      />,
      { locale: 'en' },
    );

    await user.click(screen.getByRole('button', { name: /Account menu/ }));

    expect(await screen.findByRole('menuitem', { name: 'Install app' })).toBeTruthy();
  });

  it('omits the installItem row entirely when the slot is not passed', async () => {
    const { user } = renderWithProviders(
      <UserMenu name="Rahim Uddin" roleLabel="Accountant" onSignOut={vi.fn()} />,
      { locale: 'en' },
    );

    await user.click(screen.getByRole('button', { name: /Account menu/ }));

    await screen.findByRole('menuitem', { name: /Sign out/ });
    expect(screen.queryByRole('menuitem', { name: 'Install app' })).toBeNull();
  });

  it('disables Sign out and shows "Signing out…" while signingOut is true', async () => {
    const { user } = renderWithProviders(
      <UserMenu name="Rahim Uddin" roleLabel="Accountant" onSignOut={vi.fn()} signingOut />,
      { locale: 'en' },
    );

    await user.click(screen.getByRole('button', { name: /Account menu/ }));

    const item = await screen.findByRole('menuitem', { name: /Signing out/ });
    expect(item.getAttribute('data-disabled')).toBe('');
  });
});

function fakeJwt(memberships: unknown): string {
  const payload = btoa(JSON.stringify({ memberships }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const twoSchools = [
  { tenantId: 'tenant-1', role: UserRole.ADMIN, name: 'Greenview School' },
  { tenantId: 'tenant-2', role: UserRole.TEACHER, name: 'Rose Valley School' },
];

describe('UserMenu showAccountControls', () => {
  it('omits Language / Theme rows by default', async () => {
    const { user } = renderWithProviders(<UserMenu name="Rahim" onSignOut={vi.fn()} />, {
      locale: 'en',
    });
    await user.click(screen.getByRole('button', { name: /Account menu/ }));
    await screen.findByRole('menuitem', { name: /Sign out/ });
    expect(screen.queryByRole('menuitem', { name: /Language/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Theme/ })).toBeNull();
  });

  it('shows identity, Language, Theme, profile, Switch, Sign out in order; axe clean', async () => {
    const { baseElement, user } = renderWithProviders(
      <UserMenu
        name="Rahim"
        onSignOut={vi.fn()}
        showAccountControls
        profileItem={<div role="menuitem">Security</div>}
      />,
      { accessToken: fakeJwt(twoSchools), tenantId: 'tenant-1', locale: 'en' },
    );
    await user.click(screen.getByRole('button', { name: /Account menu/ }));

    expect(await screen.findByText('Admin · Greenview School')).toBeTruthy();
    const names = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '');
    const order = ['Language', 'Theme', 'Security', 'Switch school or role', 'Sign out'];
    const idx = order.map((n) => names.findIndex((x) => x.includes(n)));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    await expect(baseElement).toHaveNoViolations();
  });

  it('switching language from the sub-menu announces it', async () => {
    const { user } = renderWithProviders(
      <UserMenu name="Rahim" onSignOut={vi.fn()} showAccountControls />,
      { accessToken: fakeJwt(twoSchools), tenantId: 'tenant-1', locale: 'en' },
    );
    await user.click(screen.getByRole('button', { name: /Account menu/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Language/ }));
    (await screen.findByRole('menuitemradio', { name: 'বাংলা' })).focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Language switched to বাংলা')).toBeTruthy();
  });

  it('switching school opens the confirm dialog and calls switchActiveTenant', async () => {
    const { user } = renderWithProviders(
      <UserMenu name="Rahim" onSignOut={vi.fn()} showAccountControls />,
      { accessToken: fakeJwt(twoSchools), tenantId: 'tenant-1', locale: 'en' },
    );
    await user.click(screen.getByRole('button', { name: /Account menu/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Switch school or role/ }));
    (await screen.findByRole('menuitem', { name: 'Rose Valley School' })).focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Switch school' }));

    await waitFor(() => expect(getActiveTenant()).toBe('tenant-2'));
  });

  it('hides the switch row with a single membership', async () => {
    const { user } = renderWithProviders(
      <UserMenu name="Rahim" onSignOut={vi.fn()} showAccountControls />,
      { accessToken: fakeJwt([twoSchools[0]]), tenantId: 'tenant-1', locale: 'en' },
    );
    await user.click(screen.getByRole('button', { name: /Account menu/ }));
    await screen.findByRole('menuitem', { name: /Language/ });
    expect(screen.queryByRole('menuitem', { name: /Switch school or role/ })).toBeNull();
  });
});
