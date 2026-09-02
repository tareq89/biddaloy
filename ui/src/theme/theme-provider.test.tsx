import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState, userEvent } from '../test/render-with-providers';
import { mockSystemPrefersDark } from '../test/system-theme';

import { useTheme } from './theme-provider';
import { getPersistedTheme } from './theme-storage';

/** Minimal probe rather than routing everything through `ThemeToggle` —
 * `theme-toggle.test.tsx` already covers the UI; this file is about
 * `useTheme()`'s own contract, including the live OS-preference sync that
 * `ThemeToggle` never exercises (nothing ever fires a `matchMedia` `change`
 * event through a click). */
function ThemeProbe() {
  const { theme, preference, setTheme, setPreference, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="preference">{preference}</span>
      <button onClick={() => setTheme('dark')}>set dark</button>
      <button onClick={() => setPreference('dark')}>preference dark</button>
      <button onClick={() => setPreference('system')}>preference system</button>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  );
}

afterEach(async () => {
  await cleanupTestState();
  localStorage.clear();
});

describe('useTheme', () => {
  it('starts light when nothing is stored and the OS prefers light', () => {
    render(<ThemeProbe />);
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('setTheme persists an explicit choice and applies it to the DOM', async () => {
    const user = userEvent.setup();
    render(<ThemeProbe />);

    await user.click(screen.getByText('set dark'));

    await within(await screen.findByTestId('theme')).findByText('dark');
    expect(getPersistedTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('toggleTheme flips the resolved theme', async () => {
    const user = userEvent.setup();
    render(<ThemeProbe />);
    expect(screen.getByTestId('theme').textContent).toBe('light');

    await user.click(screen.getByText('toggle'));
    await within(await screen.findByTestId('theme')).findByText('dark');

    await user.click(screen.getByText('toggle'));
    await within(await screen.findByTestId('theme')).findByText('light');
  });

  it('live-follows an OS preference change while no explicit choice is stored', async () => {
    render(<ThemeProbe />);
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(getPersistedTheme()).toBeNull();

    act(() => mockSystemPrefersDark(true));

    await within(await screen.findByTestId('theme')).findByText('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    // Still no explicit choice — this was the OS talking, not a user click.
    expect(getPersistedTheme()).toBeNull();

    act(() => mockSystemPrefersDark(false));
    await within(await screen.findByTestId('theme')).findByText('light');
  });

  it('an explicit choice already made is not overridden by a later OS preference change', async () => {
    const user = userEvent.setup();
    render(<ThemeProbe />);

    await user.click(screen.getByText('set dark'));
    await within(await screen.findByTestId('theme')).findByText('dark');

    // The OS now says light — the explicit 'dark' choice already made
    // should still win, per the acceptance criterion "explicit user choice
    // always winning".
    act(() => mockSystemPrefersDark(false));

    // No re-render to wait for a change that should not happen — assert the
    // steady state directly instead of racing a `waitFor` against nothing.
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(getPersistedTheme()).toBe('dark');
  });

  it('when the persisted write fails, applies the recomputed theme rather than the requested one, so the DOM cannot drift from the next getSnapshot() read', async () => {
    const user = userEvent.setup();
    // OS prefers light — the fallback `computeTheme()` resolves to once the
    // write below fails, distinct from the 'dark' this test requests.
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    render(<ThemeProbe />);

    await user.click(screen.getByText('set dark'));

    // The requested theme was never actually persisted — applying it to
    // the DOM anyway would show 'dark' now and silently flip back to
    // 'light' on the next render that recomputes from storage. Assert the
    // steady state directly: there is no successful write to wait for.
    expect(getPersistedTheme()).toBeNull();
    expect(document.documentElement.dataset.theme).not.toBe('dark');
    expect(screen.getByTestId('theme').textContent).toBe('light');

    setItemSpy.mockRestore();
  });

  it('starts with a "system" preference when nothing is stored', () => {
    render(<ThemeProbe />);
    expect(screen.getByTestId('preference').textContent).toBe('system');
  });

  it('setPreference persists an explicit choice and reports it back as the preference', async () => {
    const user = userEvent.setup();
    render(<ThemeProbe />);

    await user.click(screen.getByText('preference dark'));

    await within(await screen.findByTestId('preference')).findByText('dark');
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(getPersistedTheme()).toBe('dark');
  });

  it('setPreference("system") clears the explicit choice and hands the vote back to the OS', async () => {
    const user = userEvent.setup();
    render(<ThemeProbe />);

    await user.click(screen.getByText('preference dark'));
    await within(await screen.findByTestId('preference')).findByText('dark');

    await user.click(screen.getByText('preference system'));

    await within(await screen.findByTestId('preference')).findByText('system');
    expect(getPersistedTheme()).toBeNull();
    // OS prefers light in this test environment by default.
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });
});
