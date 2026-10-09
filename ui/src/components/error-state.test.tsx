import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../i18n';
import { cleanupTestState } from '../test';

import { ErrorState } from './error-state';

describe('ErrorState', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  afterEach(async () => {
    await cleanupTestState();
  });

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
    await user.click(screen.getByRole('button', { name: 'Retry' }));
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
    expect(wrapper?.className).toContain('text-status-overdue-fg');
    expect(wrapper?.className).toContain('bg-status-overdue-bg');
    expect(wrapper?.className).toContain('size-6');
  });

  it('sits on the shared elevated card', () => {
    render(<ErrorState message="Something went wrong." onRetry={vi.fn()} />);
    const container = screen.getByRole('alert');
    expect(container.className).toContain('shadow-e1');
    expect(container.className).toContain('bg-surface');
    expect(container.className).not.toContain('border-dashed');
  });

  it('shows a default alert icon when no icon is passed', () => {
    const { container } = render(<ErrorState message="Something went wrong." onRetry={vi.fn()} />);
    expect(container.querySelector('[data-slot="error-state"] > div svg')).not.toBeNull();
  });

  it('renders the title as an h2 when given', () => {
    render(<ErrorState title="Could not load" message="Try later." onRetry={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Could not load' })).toBeTruthy();
  });

  it('translates the default labels under bn', async () => {
    await i18n.changeLanguage('bn');
    render(<ErrorState message="x" onRetry={vi.fn()} onHome={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'আবার চেষ্টা করুন' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'হোমে ফিরুন' })).toBeTruthy();
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
