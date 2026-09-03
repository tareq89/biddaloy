import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { toast, Toaster } from './toast';

// [8.14.12]: enter/exit re-timing lives entirely in a CSS rule in
// `../styles/globals.css`, not in any prop this component passes to
// sonner — jsdom never applies a real cascade (no stylesheet, no
// specificity resolution against sonner's own injected rules), so there is
// nothing about that motion this suite can assert. Coverage for it lives
// in `e2e/reduced-motion.spec.ts`, run in a real browser.
describe('Toaster/toast', () => {
  // sonner keeps its toast queue in a module-level store outside React, so
  // a toast raised in one test survives into the next test's freshly
  // mounted <Toaster /> unless dismissed here.
  afterEach(() => {
    toast.dismiss();
  });

  it('renders inside a polite live region', async () => {
    render(<Toaster />);
    toast('Fee structure created');
    await screen.findByText('Fee structure created');
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).toBeTruthy();
    expect(region?.contains(screen.getByText('Fee structure created'))).toBe(true);
  });

  it('is dismissible by keyboard via its close button', async () => {
    const user = userEvent.setup();
    render(<Toaster />);
    toast('Payment recorded');
    await screen.findByText('Payment recorded');

    const closeButton = screen.getByRole('button', { name: 'Close toast' });
    await user.click(closeButton);
    await waitFor(() => expect(screen.queryByText('Payment recorded')).toBeNull());
  });

  it('supports success/error variants', async () => {
    render(<Toaster />);
    toast.success('Saved');
    toast.error('Failed to save');
    await screen.findByText('Saved');
    await screen.findByText('Failed to save');
  });

  // [8.14.3]: the safe-area-aware default clears the gesture-nav home
  // indicator; a caller-supplied value must still win over it.
  describe('[8.14.3] mobileOffset default', () => {
    it('defaults mobileOffset to the safe-area-aware bottom offset', async () => {
      render(<Toaster />);
      // sonner's `<ol data-sonner-toaster>` only renders once a toast
      // exists for that position — an empty `<Toaster />` renders no such
      // node at all, so a toast must be raised before it can be queried.
      toast('Fee structure created');
      await screen.findByText('Fee structure created');
      // sonner portals the toaster to `document.body`, not the RTL
      // container, so it must be looked up globally rather than scoped to
      // the render's own subtree.
      const toaster = document.querySelector('[data-sonner-toaster]');
      expect(toaster?.getAttribute('style')).toContain(
        '--mobile-offset-bottom: calc(1rem + var(--safe-area-bottom, 0px))',
      );
    });

    it('lets a caller override the default mobileOffset', async () => {
      render(<Toaster mobileOffset={{ bottom: '2rem' }} />);
      toast('Fee structure created');
      await screen.findByText('Fee structure created');
      const toaster = document.querySelector('[data-sonner-toaster]');
      expect(toaster?.getAttribute('style')).toContain('--mobile-offset-bottom: 2rem');
      expect(toaster?.getAttribute('style')).not.toContain('--safe-area-bottom');
    });
  });
});
