import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../test/render-with-providers';

import { ConfirmDialog } from './confirm-dialog';

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
});
