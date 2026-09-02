import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
