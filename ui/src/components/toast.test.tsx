import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { toast, Toaster } from './toast';

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
});
