import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CockpitIdleWarning } from './idle-warning';

const MIN = 60_000;
const strings = {
  title: 'You will be signed out in 1 minute',
  body: 'Idle',
  stay: 'Stay signed in',
  signOut: 'Sign out',
  expired: 'Signed out for inactivity',
};

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  vi.useRealTimers();
  await cleanupTestState();
});

function mount() {
  const renew = vi.fn().mockResolvedValue(undefined);
  const signOut = vi.fn().mockResolvedValue(undefined);
  const onSignedOut = vi.fn();
  renderWithProviders(
    <CockpitIdleWarning
      strings={strings}
      renew={renew}
      signOut={signOut}
      onSignedOut={onSignedOut}
    />,
    { locale: 'en', tenantId: 'tenant-1' },
  );
  return { renew, signOut, onSignedOut };
}

const warn = () => act(() => vi.advanceTimersByTimeAsync(29 * MIN));

describe('CockpitIdleWarning', () => {
  it('shows nothing until 29 minutes idle', () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Stay renews the session and closes the dialog', async () => {
    const { renew, signOut } = mount();
    await warn();
    expect(screen.getByRole('dialog', { name: strings.title })).toBeTruthy();
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: strings.stay }));
      return Promise.resolve();
    });
    expect(renew).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Sign out signs out without a notice', async () => {
    const { signOut, onSignedOut } = mount();
    await warn();
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: strings.signOut }));
      return Promise.resolve();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(onSignedOut).toHaveBeenCalledWith(null);
  });

  it('Esc does not dismiss the warning', async () => {
    const { renew, signOut } = mount();
    await warn();
    await act(() => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      return Promise.resolve();
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(renew).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('expiry signs out and passes the notice', async () => {
    const { signOut, onSignedOut } = mount();
    await warn();
    await act(() => vi.advanceTimersByTimeAsync(MIN));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(onSignedOut).toHaveBeenCalledWith(strings.expired);
  });
});
