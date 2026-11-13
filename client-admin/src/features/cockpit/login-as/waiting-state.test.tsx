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

  it('approved: Open visit fires', async () => {
    const onOpen = vi.fn();
    renderWithProviders(
      <WaitingState ownerWait={false} outcome="approved" onCancel={() => {}} onOpen={onOpen} />,
      { locale: 'en' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Open visit' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('over: says so and offers only Back', async () => {
    renderWithProviders(<WaitingState ownerWait={false} outcome="over" onCancel={() => {}} />, {
      locale: 'en',
    });
    expect(
      await screen.findByText('The school did not approve this request, or it ran out of time.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open visit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('a failed cancel shows the error and Try again', async () => {
    renderWithProviders(<WaitingState ownerWait={false} cancelFailed onCancel={() => {}} />, {
      locale: 'en',
    });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not cancel the request. Try again.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
