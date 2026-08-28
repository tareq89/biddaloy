import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

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
  const { theme, setTheme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme('dark')}>set dark</button>
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

    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'));
    expect(getPersistedTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('toggleTheme flips the resolved theme', async () => {
    const user = userEvent.setup();
    render(<ThemeProbe />);
    expect(screen.getByTestId('theme').textContent).toBe('light');

    await user.click(screen.getByText('toggle'));
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'));

    await user.click(screen.getByText('toggle'));
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('light'));
  });

  it('live-follows an OS preference change while no explicit choice is stored', async () => {
    render(<ThemeProbe />);
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(getPersistedTheme()).toBeNull();

    act(() => mockSystemPrefersDark(true));

    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    // Still no explicit choice — this was the OS talking, not a user click.
    expect(getPersistedTheme()).toBeNull();

    act(() => mockSystemPrefersDark(false));
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('light'));
  });

  it('an explicit choice already made is not overridden by a later OS preference change', async () => {
    const user = userEvent.setup();
    render(<ThemeProbe />);

    await user.click(screen.getByText('set dark'));
    await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'));

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
});
