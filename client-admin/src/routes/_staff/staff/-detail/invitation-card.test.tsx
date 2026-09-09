import { cleanupTestState, renderWithProviders, userResponseFactory } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { InvitationCard } from './invitation-card';

afterEach(async () => {
  await cleanupTestState();
});

describe('InvitationCard', () => {
  it('renders nothing once the user has activated', async () => {
    const user = userResponseFactory({ invitation_status: 'ACTIVATED' });
    const { container, localeReady } = renderWithProviders(<InvitationCard user={user} />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await localeReady;

    expect(container.textContent).toBe('');
  });

  it('shows the resend and revoke actions for a PENDING invitation', async () => {
    const user = userResponseFactory({ id: 'user-1', invitation_status: 'PENDING' });
    const { localeReady } = renderWithProviders(<InvitationCard user={user} />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await localeReady;

    expect(await screen.findByText('Invitation pending')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resend invitation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke invitation' })).toBeTruthy();
  });

  it('offers no revoke action once an invitation is REVOKED already', async () => {
    const user = userResponseFactory({ id: 'user-2', invitation_status: 'REVOKED' });
    const { localeReady } = renderWithProviders(<InvitationCard user={user} />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await localeReady;

    expect(await screen.findByText('Invitation revoked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revoke invitation' })).toBeNull();
  });

  it('revoking requires confirmation in the dialog before the mutation fires', async () => {
    const uiUser = userEvent.setup();
    const user = userResponseFactory({ id: 'user-3', invitation_status: 'PENDING' });
    const { localeReady } = renderWithProviders(<InvitationCard user={user} />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await localeReady;

    await uiUser.click(await screen.findByRole('button', { name: 'Revoke invitation' }));
    expect(await screen.findByText('Revoke this invitation?')).toBeTruthy();

    const confirmButtons = screen.getAllByRole('button', { name: 'Revoke invitation' });
    const confirmButton = confirmButtons[confirmButtons.length - 1];
    if (!confirmButton) throw new Error('expected a confirm button');
    await uiUser.click(confirmButton);

    await waitFor(() => expect(screen.queryByText('Revoke this invitation?')).toBeNull());
  });
});
