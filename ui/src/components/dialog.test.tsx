import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, i18n, whenReady } from '../i18n';
import { renderWithProviders } from '../test/render-with-providers';

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
import { HelpHint, HelpProvider } from './help-hint';

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
    // Long (bn) button labels wrap onto a new line instead of overflowing the dialog.
    expect(footer?.className).toContain('md:flex-wrap');
  });

  it('sizes: md default 560, sm 400, lg 720; a caller max-w replaces the size class', async () => {
    const mk = (props: React.ComponentProps<typeof DialogContent>) => (
      <Dialog open>
        <DialogContent {...props}>
          <DialogTitle>T</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    const { rerender } = render(mk({}));
    expect((await screen.findByRole('dialog')).className).toContain('max-w-140');
    rerender(mk({ size: 'sm' }));
    expect(screen.getByRole('dialog').className).toContain('max-w-100');
    rerender(mk({ size: 'lg' }));
    expect(screen.getByRole('dialog').className).toContain('max-w-180');
    rerender(mk({ className: 'max-w-2xl' }));
    const cls = screen.getByRole('dialog').className;
    expect(cls).toContain('max-w-2xl');
    expect(cls).not.toContain('max-w-140');
  });

  it('[67.2.11] fullScreenOnPhone adds the phone full-screen classes and keeps the size class', async () => {
    const mk = (props: React.ComponentProps<typeof DialogContent>) => (
      <Dialog open>
        <DialogContent {...props}>
          <DialogTitle>T</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    const { rerender } = render(mk({}));
    const plain = (await screen.findByRole('dialog')).className.split(/\s+/);
    expect(plain.some((c) => c.startsWith('max-md:'))).toBe(false);
    rerender(mk({ fullScreenOnPhone: true }));
    const full = screen.getByRole('dialog').className.split(/\s+/);
    for (const c of [
      'max-md:inset-0',
      'max-md:h-dvh',
      'max-md:rounded-none',
      'max-md:max-w-none',
    ]) {
      expect(full).toContain(c);
    }
    expect(full).toContain('max-w-140');
  });

  it('footer has no grey band or top border', async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>T</DialogTitle>
          <DialogFooter>
            <Button>Go</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    await screen.findByRole('dialog');
    const cls = screen.getByRole('button', { name: 'Go' }).closest('div')?.className ?? '';
    expect(cls).not.toContain('bg-muted/50');
    expect(cls).not.toContain('border-t');
  });

  it('close button is named in Bangla under locale bn', async () => {
    const { localeReady } = renderWithProviders(
      <Dialog open>
        <DialogContent>
          <DialogTitle>T</DialogTitle>
        </DialogContent>
      </Dialog>,
      { locale: 'bn' },
    );
    await localeReady;
    expect(await screen.findByRole('button', { name: 'বন্ধ করুন' })).toBeTruthy();
  });

  it('[Epic 44] opens on the first field, not on a (?) before it, and keeps the (?) tabbable', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Reverse payment</DialogTitle>
          <button type="button" data-help-id="finance.payments.action.reverse">
            ?
          </button>
          <input aria-label="Reason" />
        </DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const reason = await screen.findByRole('textbox', { name: 'Reason' });
    await waitFor(() => expect(document.activeElement).toBe(reason));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '?' }).hasAttribute('tabindex')).toBe(false),
    );
  });
});

describe('Dialog with a HelpHint (#3213)', () => {
  const index = {
    a: {
      title: { bn: 'হাজিরা', en: 'Attendance' },
      summary: { bn: 'হাজিরা নিন', en: 'Take attendance' },
      path: 'attendance/register',
      anchor: 'task-main',
      knownIssues: 0,
    },
  };

  beforeEach(async () => {
    await whenReady(i18n);
    await i18n.changeLanguage('en');
  });

  async function open(onOpenAutoFocus?: (e: Event) => void) {
    const user = userEvent.setup();
    render(
      <HelpProvider index={index} lang="en" baseUrl="https://guide.test">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Open</Button>
          </DialogTrigger>
          <DialogContent onOpenAutoFocus={onOpenAutoFocus}>
            <DialogHeader>
              <DialogTitle>
                Record a payment <HelpHint helpId="a" />
              </DialogTitle>
              <DialogDescription>Enter the amount.</DialogDescription>
            </DialogHeader>
            <input aria-label="Amount" />
          </DialogContent>
        </Dialog>
      </HelpProvider>,
      { wrapper: I18nProvider },
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');
    return user;
  }
  const hint = () => screen.findByRole('button', { name: 'Help: Attendance' });

  it('opens its card without closing the dialog', async () => {
    const user = await open();
    (await hint()).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Take attendance')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /Record a payment/ })).toBeTruthy();
  });

  it('a caller preventDefault on onOpenAutoFocus wins (no tabindex flip)', async () => {
    await open((e) => e.preventDefault());
    expect((await hint()).hasAttribute('tabindex')).toBe(false);
    // Radix skipped its own focus too, so the (?) is not forced away from the dialog.
    expect(document.activeElement).not.toBe(screen.getByLabelText('Amount'));
  });
});
