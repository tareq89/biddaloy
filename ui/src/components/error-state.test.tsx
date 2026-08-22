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

  it('wraps a passed icon in a sizing/colour container rather than rendering it bare at whatever size the caller happened to pass', () => {
    render(
      <ErrorState
        message="Something went wrong."
        onRetry={vi.fn()}
        icon={<svg data-testid="icon" />}
      />,
    );
    const icon = screen.getByTestId('icon');
    const wrapper = icon.parentElement;
    expect(wrapper?.className).toContain('text-muted-foreground');
    expect(wrapper?.className).toContain('size-8');
  });

  it('renders no icon wrapper at all when no icon is passed', () => {
    const { container } = render(<ErrorState message="Something went wrong." onRetry={vi.fn()} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders no home affordance when onHome is not passed', () => {
    render(<ErrorState message="Something went wrong." onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Go home' })).toBeNull();
  });

  it('offers a home affordance that calls onHome when passed', async () => {
    const onHome = vi.fn();
    const user = userEvent.setup();
    render(<ErrorState message="Something went wrong." onRetry={vi.fn()} onHome={onHome} />);
    await user.click(screen.getByRole('button', { name: 'Go home' }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('supports a custom home label', () => {
    render(
      <ErrorState
        message="Something went wrong."
        onRetry={vi.fn()}
        onHome={vi.fn()}
        homeLabel="Back to dashboard"
      />,
    );
    expect(screen.getByRole('button', { name: 'Back to dashboard' })).toBeTruthy();
  });

  it('is axe clean with a home affordance too', async () => {
    const { container } = render(
      <ErrorState message="Something went wrong." onRetry={vi.fn()} onHome={vi.fn()} />,
    );
    await expect(container).toHaveNoViolations();
  });
});
