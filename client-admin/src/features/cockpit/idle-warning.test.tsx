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

function mount(over: { renew?: () => Promise<unknown>; signOut?: () => Promise<unknown> } = {}) {
  const renew = vi.fn(over.renew ?? (() => Promise.resolve()));
  const signOut = vi.fn(over.signOut ?? (() => Promise.resolve()));
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
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Stay renews the session and closes the dialog', async () => {
    const { renew, signOut } = mount();
    await warn();
    expect(screen.getByRole('alertdialog', { name: strings.title })).toBeTruthy();
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: strings.stay }));
      return Promise.resolve();
    });
    expect(renew).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
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
      fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
      return Promise.resolve();
    });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
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

  it('expiry still leaves when sign-out never settles', async () => {
    const { onSignedOut } = mount({ signOut: () => new Promise(() => undefined) });
    await warn();
    await act(() => vi.advanceTimersByTimeAsync(MIN));
    expect(onSignedOut).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(onSignedOut).toHaveBeenCalledWith(strings.expired);
  });

  it('is an alertdialog and focuses Stay signed in', async () => {
    mount();
    await warn();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: strings.stay }));
  });

  it('an outside click does not dismiss it', async () => {
    mount();
    await warn();
    await act(() => {
      fireEvent.pointerDown(document.body);
      fireEvent.click(document.body);
      return Promise.resolve();
    });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('a failed renew keeps the dialog and expiry still signs out', async () => {
    const { signOut, onSignedOut } = mount({ renew: () => Promise.reject(new Error('401')) });
    await warn();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: strings.stay }));
      await Promise.resolve();
    });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(MIN));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(onSignedOut).toHaveBeenCalledWith(strings.expired);
  });

  it('signOut rejecting still calls onSignedOut', async () => {
    const { onSignedOut } = mount({ signOut: () => Promise.reject(new Error('net')) });
    await warn();
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: strings.signOut }));
      return Promise.resolve();
    });
    expect(onSignedOut).toHaveBeenCalledWith(null);
  });

  it('double-clicking Sign out, then expiry, signs out once', async () => {
    const { signOut } = mount({ signOut: () => new Promise((r) => setTimeout(r, 5000)) });
    await warn();
    const btn = screen.getByRole('button', { name: strings.signOut });
    await act(() => {
      fireEvent.click(btn);
      fireEvent.click(btn);
      return Promise.resolve();
    });
    await act(() => vi.advanceTimersByTimeAsync(MIN));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('Sign out stays clickable while a renewal is pending, and a late renewal does not undo it', async () => {
    let finish: () => void = () => undefined;
    const { onSignedOut, signOut } = mount({
      renew: () => new Promise<void>((resolve) => (finish = resolve)),
    });
    await warn();
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: strings.stay }));
      return Promise.resolve();
    });
    const out = screen.getByRole('button', { name: strings.signOut });
    expect(out).toHaveProperty('disabled', false);
    await act(() => {
      fireEvent.click(out);
      return Promise.resolve();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(onSignedOut).toHaveBeenCalledWith(null);
    await act(() => {
      finish();
      return Promise.resolve();
    });
    await act(() => vi.advanceTimersByTimeAsync(2 * MIN));
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });
});

describe('CockpitIdleWarning keepalive (#4075)', () => {
  it('sends one renewal per 5 minutes of activity, none while only polling', async () => {
    const { renew } = mount();
    fireEvent.pointerDown(window);
    expect(renew).not.toHaveBeenCalled(); // renewed moments ago by the mount
    await act(() => vi.advanceTimersByTimeAsync(6 * MIN));
    fireEvent.pointerDown(window);
    fireEvent.pointerDown(window);
    expect(renew).toHaveBeenCalledTimes(1);
  });
});
