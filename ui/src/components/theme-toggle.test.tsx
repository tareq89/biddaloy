import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';
import { getPersistedTheme } from '../theme/theme-storage';

import { ThemeToggle } from './theme-toggle';

// Mirrors `client-admin/index.html`'s static tag — not present in jsdom's
// default (empty) document head, so component tests that assert on it have
// to add their own, same as any other DOM fixture a test provides.
function addThemeColorMeta(): HTMLMetaElement {
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', '#4a3fd4');
  document.head.appendChild(meta);
  return meta;
}

beforeEach(() => {
  addThemeColorMeta();
});

afterEach(async () => {
  await cleanupTestState();
  localStorage.clear();
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
});

describe('ThemeToggle', () => {
  it('starts light (no persisted choice, light OS default) with a "switch to dark" name', async () => {
    renderWithProviders(<ThemeToggle />);

    const button = await screen.findByRole('button', { name: 'Switch to dark theme' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('flips the data-theme attribute, persists the choice, and flips its own name/pressed state', async () => {
    const { user } = renderWithProviders(<ThemeToggle />);

    const button = await screen.findByRole('button', { name: 'Switch to dark theme' });
    await user.click(button);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(getPersistedTheme()).toBe('dark');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy(),
    );
    expect(
      screen.getByRole('button', { name: 'Switch to light theme' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('toggling back to light removes the attribute rather than setting it to "light"', async () => {
    const { user } = renderWithProviders(<ThemeToggle />);

    await user.click(await screen.findByRole('button', { name: 'Switch to dark theme' }));
    await user.click(await screen.findByRole('button', { name: 'Switch to light theme' }));

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(getPersistedTheme()).toBe('light');
  });

  it('updates the theme-color meta tag to the dark surface colour, and back', async () => {
    const { user } = renderWithProviders(<ThemeToggle />);
    const meta = document.querySelector('meta[name="theme-color"]');

    await user.click(await screen.findByRole('button', { name: 'Switch to dark theme' }));
    expect(meta?.getAttribute('content')).toBe('#1e293b');

    await user.click(await screen.findByRole('button', { name: 'Switch to light theme' }));
    expect(meta?.getAttribute('content')).toBe('#4a3fd4');
  });

  it('is axe clean in both the light and dark rendered states', async () => {
    const { user, baseElement } = renderWithProviders(<ThemeToggle />);

    await expect(baseElement).toHaveNoViolations();

    await user.click(await screen.findByRole('button', { name: 'Switch to dark theme' }));
    await expect(baseElement).toHaveNoViolations();
  });

  it('the choice made through the toggle survives a fresh mount, same as a reload would show', async () => {
    const first = renderWithProviders(<ThemeToggle />);
    await first.user.click(await screen.findByRole('button', { name: 'Switch to dark theme' }));
    first.unmount();

    renderWithProviders(<ThemeToggle />);

    expect(await screen.findByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
