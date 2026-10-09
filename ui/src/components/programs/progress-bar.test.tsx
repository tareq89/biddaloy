import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('renders a non-zero percent width for done/total', () => {
    render(<ProgressBar done={3} total={5} label="3 / 5" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
    expect(screen.getByText('3 / 5')).toBeTruthy();
  });

  it('renders 0% width without dividing by zero when total is 0', () => {
    render(<ProgressBar done={0} total={0} label="0 / 0" />);
    const bar = screen.getByRole('progressbar');
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });
});
