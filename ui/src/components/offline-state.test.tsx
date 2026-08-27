import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OfflineState } from './offline-state';

describe('OfflineState', () => {
  it('says the user is offline and what to do about it', () => {
    render(<OfflineState onRetry={() => {}} />);

    expect(screen.getByRole('heading', { level: 1, name: "You're offline" })).toBeTruthy();
    expect(screen.getByText(/check your network/i)).toBeTruthy();
  });

  it('announces politely, not as an alert — no signal is not an error', () => {
    render(<OfflineState onRetry={() => {}} />);

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retries on demand', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<OfflineState onRetry={onRetry} />);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the home affordance unless the caller supplies navigation', () => {
    const { rerender } = render(<OfflineState onRetry={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Go home' })).toBeNull();

    rerender(<OfflineState onRetry={() => {}} onHome={() => {}} />);
    expect(screen.getByRole('button', { name: 'Go home' })).toBeTruthy();
  });

  it('navigates home on demand', async () => {
    const user = userEvent.setup();
    const onHome = vi.fn();
    render(<OfflineState onRetry={() => {}} onHome={onHome} />);

    await user.click(screen.getByRole('button', { name: 'Go home' }));

    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('accepts translated copy and labels', () => {
    render(
      <OfflineState
        title="আপনি অফলাইনে আছেন"
        explanation="সংযোগ পরীক্ষা করুন।"
        retryLabel="আবার চেষ্টা করুন"
        onRetry={() => {}}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'আপনি অফলাইনে আছেন' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'আবার চেষ্টা করুন' })).toBeTruthy();
  });

  it('is axe clean', async () => {
    const { container } = render(<OfflineState onRetry={() => {}} onHome={() => {}} />);

    await expect(container).toHaveNoViolations();
  });
});
