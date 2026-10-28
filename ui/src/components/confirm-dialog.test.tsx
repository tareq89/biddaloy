import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../test/render-with-providers';

import { ConfirmDialog } from './confirm-dialog';
import { HelpProvider, type HelpIndex } from './help-hint';

function setup(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  const utils = renderWithProviders(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Delete fee?"
      description="This cannot be undone."
      confirmLabel="Delete"
      onConfirm={onConfirm}
      {...props}
    />,
    { locale: 'en' },
  );
  return { onOpenChange, onConfirm, ...utils };
}

describe('ConfirmDialog', () => {
  it('is an alertdialog with title, description, no close X, and axe clean', async () => {
    const { baseElement, localeReady } = setup();
    await localeReady;
    const d = await screen.findByRole('alertdialog', { name: 'Delete fee?' });
    expect(d.textContent).toContain('This cannot be undone.');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    await expect(baseElement).toHaveNoViolations();
  });

  it('ignores outside clicks', async () => {
    const { onOpenChange, localeReady } = setup();
    await localeReady;
    await screen.findByRole('alertdialog');
    await userEvent.setup({ pointerEventsCheck: 0 }).click(document.body);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('Cancel closes, Confirm confirms, danger tone is data-variant=danger', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onConfirm, localeReady } = setup();
    await localeReady;
    const confirm = await screen.findByRole('button', { name: 'Delete' });
    expect(confirm.getAttribute('data-variant')).toBe('danger');
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('busy: aria-busy confirm, disabled Cancel, Esc ignored', async () => {
    const { onOpenChange, localeReady } = setup({ busy: true });
    await localeReady;
    const confirm = await screen.findByRole('button', { name: /Delete/ });
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
    await userEvent.setup().keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  describe('helpId', () => {
    const index: HelpIndex = {
      del: {
        title: { bn: 'ম', en: 'Deleting fees' },
        summary: { bn: 's', en: 's' },
        path: 'p',
        anchor: 'task-delete',
        knownIssues: 0,
      },
    };
    const open = (helpId?: string) => {
      const utils = renderWithProviders(
        <HelpProvider index={index} lang="en" baseUrl="https://g.test">
          <ConfirmDialog
            open
            onOpenChange={() => undefined}
            title="Delete fee?"
            description="This cannot be undone."
            confirmLabel="Delete"
            onConfirm={() => undefined}
            helpId={helpId}
          />
        </HelpProvider>,
        { locale: 'en' },
      );
      return utils;
    };

    it('renders a (?) beside the title; the dialog name stays the title', async () => {
      const { localeReady } = open('del');
      await localeReady;
      await screen.findByRole('alertdialog', { name: 'Delete fee?' });
      const hint = await screen.findByRole('button', { name: 'Help: Deleting fees' });
      expect(hint.getAttribute('data-help-id')).toBe('del');
    });

    it('first focus is not the (?)', async () => {
      const { localeReady } = open('del');
      await localeReady;
      await screen.findByRole('button', { name: 'Help: Deleting fees' });
      expect(document.activeElement?.getAttribute('data-help-id')).toBeNull();
    });

    it('an unknown id draws nothing and keeps the header DOM', async () => {
      const { localeReady } = open('nope');
      await localeReady;
      const title = await screen.findByRole('heading', { name: 'Delete fee?' });
      expect(screen.queryByRole('button', { name: /Help/ })).toBeNull();
      expect(title.parentElement?.className).toContain('flex-col');
    });
  });
});
