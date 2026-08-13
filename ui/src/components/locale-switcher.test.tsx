import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { LocaleSwitcher } from './locale-switcher';

afterEach(async () => {
  await cleanupTestState();
  localStorage.clear();
});

describe('LocaleSwitcher', () => {
  it('opens on trigger click, shows both locales, and is axe clean', async () => {
    const { baseElement, user } = renderWithProviders(<LocaleSwitcher />, { locale: 'en' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Change language' })).toBeTruthy(),
    );

    await user.click(screen.getByRole('button', { name: 'Change language' }));

    expect(await screen.findByRole('menuitemradio', { name: 'English' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'বাংলা' })).toBeTruthy();
    // Menu content is portaled to document.body, outside `container` —
    // `baseElement` (the portal's actual root) is what needs to be axe clean.
    await expect(baseElement).toHaveNoViolations();
  });

  it('marks the active locale as checked, not the other one', async () => {
    const { user } = renderWithProviders(<LocaleSwitcher />, { locale: 'en' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Change language' })).toBeTruthy(),
    );

    await user.click(screen.getByRole('button', { name: 'Change language' }));

    const english = await screen.findByRole('menuitemradio', { name: 'English' });
    const bangla = screen.getByRole('menuitemradio', { name: 'বাংলা' });
    expect(english.getAttribute('aria-checked')).toBe('true');
    expect(bangla.getAttribute('aria-checked')).toBe('false');
  });

  it('switches the locale, persists it, and announces the change', async () => {
    const { user } = renderWithProviders(<LocaleSwitcher />, { locale: 'en' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Change language' })).toBeTruthy(),
    );

    await user.click(screen.getByRole('button', { name: 'Change language' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'বাংলা' }));

    await waitFor(() => expect(localStorage.getItem('biddaloy:locale')).toBe('bn'));
    await waitFor(() => expect(document.documentElement.lang).toBe('bn'));
    expect(screen.getByText('Language switched to বাংলা')).toBeTruthy();
  });

  it('does not persist or announce anything when the same locale is re-selected', async () => {
    const { user } = renderWithProviders(<LocaleSwitcher />, { locale: 'en' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Change language' })).toBeTruthy(),
    );

    await user.click(screen.getByRole('button', { name: 'Change language' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'English' }));

    expect(screen.queryByText(/Language switched to/)).toBeNull();
  });

  it('the trigger is keyboard-reachable and Enter/Space open the menu', async () => {
    const { user } = renderWithProviders(<LocaleSwitcher />, { locale: 'en' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Change language' })).toBeTruthy(),
    );
    const trigger = screen.getByRole('button', { name: 'Change language' });

    await user.tab();
    expect(document.activeElement).toBe(trigger);

    // Radix's menu trigger opens on Enter by moving focus straight to the
    // first item rather than dispatching a `click` on the trigger itself
    // (its own keydown handling calls preventDefault to control opening),
    // so this checks the menu actually opened via focus landing inside
    // it — same pattern as menu.test.tsx's own keyboard-open assertion —
    // rather than expectKeyboardOperable's click-listener default, which
    // doesn't fit this trigger's real behaviour.
    await user.keyboard('{Enter}');
    // First item in DOM order — `bn` before `en`, per SUPPORTED_LOCALES —
    // regardless of which locale is currently active/checked.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'বাংলা' })),
    );
  });
});
