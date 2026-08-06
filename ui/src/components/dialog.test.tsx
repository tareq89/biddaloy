import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';

function RecordPaymentDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Record payment</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>Enter the amount received.</DialogDescription>
        </DialogHeader>
        <input aria-label="Amount" />
        <DialogFooter>
          <Button>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('opens on trigger click, is axe clean, and carries a real title', async () => {
    const user = userEvent.setup();
    const { container } = render(<RecordPaymentDialog />);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByRole('dialog', { name: 'Record a payment' })).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('traps focus inside the dialog — Tab cannot reach content behind it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>Outside button, never reachable while the dialog is open</button>
        <RecordPaymentDialog />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await screen.findByRole('dialog');

    for (let i = 0; i < 15; i++) {
      await user.tab();
      expect(document.activeElement?.textContent).not.toBe(
        'Outside button, never reachable while the dialog is open',
      );
    }
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<RecordPaymentDialog />);
    const trigger = screen.getByRole('button', { name: 'Record payment' });
    await user.click(trigger);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
