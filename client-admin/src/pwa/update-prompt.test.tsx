/**
 * [8.12.2]: the update prompt's contract — polite, deduped, dismissible.
 */
import { toast, Toaster } from '@biddaloy/ui/components';
import { i18n, whenReady } from '@biddaloy/ui/i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { showUpdatedElsewherePrompt, showUpdatePrompt } from './update-prompt';

const AVAILABLE = 'A new version of the app is available.';
const ELSEWHERE = "The app has been updated in another tab. Reload this tab when you're ready.";

describe('update prompts', () => {
  beforeEach(async () => {
    // These modules call `i18n.t()` outside React — no `useTranslation()`
    // suspense to wait on their behalf — so the singleton's own init has
    // to have settled before the asserted copy resolves.
    await whenReady(i18n);
    // `DEFAULT_LOCALE` is Bengali, so the assertions below would otherwise
    // depend on the bn copy. Pinned to English here: what this file tests
    // is the prompt's behaviour, not which locale wins — bn/en parity for
    // these keys is enforced by `ui/scripts/check-i18n-keys.mjs`. Per
    // test, not once: `cleanupTestState` (`ui/src/test/setup.ts`) resets the
    // shared i18next instance's language after every test.
    await i18n.changeLanguage('en');
  });

  // sonner's queue is module-level state outside React — a toast raised in
  // one test outlives that test's `<Toaster />` without this. The frame
  // wait matters: `dismiss()` finishes its bookkeeping in a
  // `requestAnimationFrame`, and a create landing before that frame is
  // treated as an *update* of the still-listed toast, which the next
  // test's freshly mounted `<Toaster />` never saw and so never renders.
  afterEach(async () => {
    toast.dismiss();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });

  it('offers a reload action that runs the accept callback', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    render(<Toaster />);

    showUpdatePrompt(onReload);

    await screen.findByText(AVAILABLE);
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('announces politely and is dismissible without reloading', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    render(<Toaster />);

    showUpdatePrompt(onReload);
    const body = await screen.findByText(AVAILABLE);
    expect(document.querySelector('[aria-live="polite"]')?.contains(body)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Close toast' }));
    await waitFor(() => expect(screen.queryByText(AVAILABLE)).toBeNull());
    expect(onReload).not.toHaveBeenCalled();
  });

  it('replaces rather than stacks when raised twice', async () => {
    render(<Toaster />);

    showUpdatePrompt(vi.fn());
    showUpdatePrompt(vi.fn());

    await screen.findByText(AVAILABLE);
    expect(screen.getAllByText(AVAILABLE)).toHaveLength(1);
  });

  it('replaces the first prompt with the "updated elsewhere" copy', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    render(<Toaster />);

    showUpdatePrompt(vi.fn());
    await screen.findByText(AVAILABLE);

    showUpdatedElsewherePrompt(onReload);
    await screen.findByText(ELSEWHERE);
    expect(screen.queryByText(AVAILABLE)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
