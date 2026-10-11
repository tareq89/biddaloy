import { UserRole } from '@biddaloy/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { SchoolInvitesCard } from './school-invites-card';

afterEach(async () => {
  await cleanupTestState();
});

const invites = [
  {
    id: 'invite-1',
    school_id: 'school-1',
    school_name: 'Rose Valley School',
    role: UserRole.PARENT,
    expires_at: '2026-10-20T00:00:00.000Z',
  },
];

async function renderCard(props: Partial<React.ComponentProps<typeof SchoolInvitesCard>> = {}) {
  const onAccept = vi.fn();
  const onDecline = vi.fn();
  const { container, localeReady } = renderWithProviders(
    <SchoolInvitesCard invites={invites} onAccept={onAccept} onDecline={onDecline} {...props} />,
    { locale: 'en' },
  );
  await localeReady;
  return { container, onAccept, onDecline };
}

describe('SchoolInvitesCard', () => {
  it('renders nothing for an empty list', async () => {
    await renderCard({ invites: [] });
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the school and the role', async () => {
    await renderCard();
    expect(await screen.findByText('Rose Valley School')).toBeTruthy();
    expect(screen.getByText(/Parent/)).toBeTruthy();
  });

  it('Accept calls the handler with the invite id', async () => {
    const { onAccept, onDecline } = await renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(onAccept).toHaveBeenCalledWith('invite-1');
    expect(onDecline).not.toHaveBeenCalled();
  });

  it('Decline calls the handler with the invite id', async () => {
    const { onDecline } = await renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(onDecline).toHaveBeenCalledWith('invite-1');
  });

  it('busy disables both buttons', async () => {
    await renderCard({ busy: true });
    expect((await screen.findByRole('button', { name: 'Accept' })).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Decline' }).hasAttribute('disabled')).toBe(true);
  });

  it('error text is shown', async () => {
    await renderCard({ error: 'Something went wrong' });
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong');
  });
});
