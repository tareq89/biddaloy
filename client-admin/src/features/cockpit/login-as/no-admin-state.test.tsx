import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoAdminState } from './no-admin-state';

afterEach(cleanupTestState);

describe('NoAdminState', () => {
  it('says there is no active admin and Invite admin fires', async () => {
    const onInvite = vi.fn();
    renderWithProviders(<NoAdminState onInvite={onInvite} />, { locale: 'en' });
    expect(
      await screen.findByText('This school has no active admin. Invite one first.'),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Invite admin' }));
    expect(onInvite).toHaveBeenCalled();
  });
});
