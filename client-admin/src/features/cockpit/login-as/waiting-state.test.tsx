import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WaitingState } from './waiting-state';

afterEach(cleanupTestState);

describe('WaitingState', () => {
  it('tells the school admins were told, shows time left, and Cancel fires', async () => {
    const onCancel = vi.fn();
    renderWithProviders(<WaitingState ownerWait={false} onCancel={onCancel} />, { locale: 'en' });
    expect(
      await screen.findByText('Waiting for approval. We told the school admins.'),
    ).toBeTruthy();
    expect(screen.getByText('Time left 24 h')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('says the other owner is needed for emergency access', async () => {
    renderWithProviders(<WaitingState ownerWait onCancel={() => {}} />, { locale: 'en' });
    expect(await screen.findByText('Waiting for the other owner to agree.')).toBeTruthy();
  });
});
