import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ErrorState } from './error-state';

describe('ErrorState', () => {
  it('renders plain-language messaging, never a raw error payload', () => {
    render(
      <ErrorState
        message="Could not load students. Check your connection and try again."
        onRetry={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Could not load students. Check your connection and try again.'),
    ).toBeTruthy();
  });

  it('announces itself via role=alert', () => {
    render(<ErrorState message="Something went wrong." onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('offers a retry affordance that calls onRetry', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorState message="Something went wrong." onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('supports a custom retry label', () => {
    render(<ErrorState message="Something went wrong." onRetry={vi.fn()} retryLabel="Reload" />);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('is axe clean', async () => {
    const { container } = render(<ErrorState message="Something went wrong." onRetry={vi.fn()} />);
    await expect(container).toHaveNoViolations();
  });
});
