import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';
import { getPersistedTheme } from '../theme/theme-storage';

import { ThemeToggle } from './theme-toggle';

// Mirrors `client-admin/index.html`'s static tag — not present in jsdom's
// default (empty) document head, so a component test that asserts on it
// has to add its own, same as any other DOM fixture this test provides.
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
  it('opens on trigger click, shows all three choices, and is axe clean', async () => {
    const { baseElement, user } = renderWithProviders(<ThemeToggle />, { locale: 'en' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Theme' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Theme' }));

    expect(await screen.findByRole('menuitemradio', { name: 'Light' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toBeTruthy();
    // Menu content is portaled to document.body, outside `container` —
    // `baseElement` (the portal's actual root) is what needs to be axe
    // clean.
    await expect(baseElement).toHaveNoViolations();
  });

  it('starts with "System" checked (no persisted choice, light OS default)', async () => {
    const { user } = renderWithProviders(<ThemeToggle />, { locale: 'en' });
    await user.click(await screen.findByRole('button', { name: 'Theme' }));

    const system = await screen.findByRole('menuitemradio', { name: 'System' });
    expect(system.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('picking Dark flips data-theme, persists the choice, and checks Dark next open', async () => {
    const { user } = renderWithProviders(<ThemeToggle />, { locale: 'en' });
    await user.click(await screen.findByRole('button', { name: 'Theme' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(getPersistedTheme()).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Theme' }));
    const dark = await screen.findByRole('menuitemradio', { name: 'Dark' });
    expect(dark.getAttribute('aria-checked')).toBe('true');
  });

  it('picking System after an explicit choice clears the persisted value', async () => {
    const { user } = renderWithProviders(<ThemeToggle />, { locale: 'en' });
    await user.click(await screen.findByRole('button', { name: 'Theme' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));
    expect(getPersistedTheme()).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'System' }));

    expect(getPersistedTheme()).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('updates the theme-color meta tag when the resolved theme changes', async () => {
    const { user } = renderWithProviders(<ThemeToggle />, { locale: 'en' });
    const meta = document.querySelector('meta[name="theme-color"]');

    await user.click(await screen.findByRole('button', { name: 'Theme' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));
    expect(meta?.getAttribute('content')).toBe('#1e293b');

    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Light' }));
    expect(meta?.getAttribute('content')).toBe('#4a3fd4');
  });

  it('announces the switch via the aria-live region', async () => {
    const { user } = renderWithProviders(<ThemeToggle />, { locale: 'en' });
    await user.click(await screen.findByRole('button', { name: 'Theme' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));

    expect(await screen.findByText('Theme set to Dark')).toBeTruthy();
  });

  it('the choice made through the menu survives a fresh mount, same as a reload would show', async () => {
    const first = renderWithProviders(<ThemeToggle />, { locale: 'en' });
    await first.user.click(await screen.findByRole('button', { name: 'Theme' }));
    await first.user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));
    first.unmount();

    const { user } = renderWithProviders(<ThemeToggle />, { locale: 'en' });
    await user.click(await screen.findByRole('button', { name: 'Theme' }));

    const dark = await screen.findByRole('menuitemradio', { name: 'Dark' });
    expect(dark.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
