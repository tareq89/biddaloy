import '@biddaloy/ui/test';

import type { PlatformUserItem } from '@biddaloy/ui/hooks';
import { i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserResults } from './-user-results';

const anika: PlatformUserItem = {
  userId: '22222222-2222-4222-8222-222222222201',
  fullName: 'Anika Rahman',
  emailMasked: 'a***@example.test',
  phoneMasked: '017****001',
  status: 'ACTIVE',
  locked: false,
  lastLoginAt: null,
  memberships: [
    { memberId: 'm1', schoolId: 's1', schoolName: 'Green Valley', role: 'TEACHER' },
    { memberId: 'm2', schoolId: 's2', schoolName: 'Sunrise', role: 'PARENT' },
  ],
};

const render = async (props: Partial<React.ComponentProps<typeof UserResults>> = {}) => {
  await i18n.loadNamespaces(['platformUsers', 'loginAs']);
  await i18n.changeLanguage('en');
  const handlers = { onLoginAs: vi.fn(), onLogout: vi.fn(), onRetry: vi.fn() };
  renderWithProviders(
    <UserResults users={[anika]} loading={false} error={false} {...handlers} {...props} />,
  );
  return handlers;
};

afterEach(async () => {
  await cleanupTestState();
});

describe('UserResults', () => {
  it('lists each school with its role and a Login as per row', async () => {
    const { onLoginAs } = await render();
    expect(screen.getByText('Green Valley (Teacher)')).toBeTruthy();
    expect(screen.getByText('Sunrise (Parent)')).toBeTruthy();
    expect(screen.getByText('Has not logged in yet')).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: 'Login as Anika Rahman at Sunrise (Parent)' }),
    );
    expect(onLoginAs).toHaveBeenCalledWith(anika, anika.memberships[1]);
  });

  it('Sign out everywhere calls onLogout', async () => {
    const { onLogout } = await render();
    await userEvent.click(screen.getByRole('button', { name: 'Sign Anika Rahman out everywhere' }));
    expect(onLogout).toHaveBeenCalledWith(anika);
  });

  it('shows Locked and No login account, and disables the buttons for no login', async () => {
    await render({ users: [{ ...anika, locked: true, status: 'INACTIVE' }] });
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.getByText('No login account')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sign Anika Rahman out/ })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows the empty state', async () => {
    await render({ users: [] });
    expect(screen.getByText('No one found.')).toBeTruthy();
  });

  it('shows a fixed error with Try again', async () => {
    const { onRetry } = await render({ error: true, users: [] });
    expect(screen.getByRole('alert').textContent).toContain('Could not search. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
