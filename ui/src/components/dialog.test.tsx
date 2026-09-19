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
    const { baseElement } = render(<RecordPaymentDialog />);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByRole('dialog', { name: 'Record a payment' })).toBeTruthy();
    // Dialog content is portaled to `document.body`, outside `container` —
    // `baseElement` (the portal's actual root) is what needs to be axe clean.
    await expect(baseElement).toHaveNoViolations();
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

  // [#823] jsdom doesn't compute real layout, so this can't assert "the
  // footer button is on screen" the way a real browser would — it checks
  // the CSS contract instead: `DialogContent` caps its own height and
  // scrolls, `DialogFooter` stays `sticky` at the bottom of that scroll
  // container, so a body taller than the viewport can never push the
  // footer (and its submit button) out of reach the way it used to.
  it('caps content height and keeps the footer sticky, so a tall body cannot push it off-screen', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate fees</DialogTitle>
            <DialogDescription>A body taller than the viewport.</DialogDescription>
          </DialogHeader>
          <div style={{ height: '2000px' }}>Tall content</div>
          <DialogFooter>
            <Button>Generate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

    const dialogEl = await screen.findByRole('dialog');
    expect(dialogEl.className).toContain('overflow-y-auto');
    expect(dialogEl.className).toMatch(/max-h-\[calc\(100dvh-2rem\)\]/);

    const footer = screen.getByRole('button', { name: 'Generate' }).closest('div');
    expect(footer?.className).toContain('sticky');
    expect(footer?.className).toContain('bottom-0');
  });
});
