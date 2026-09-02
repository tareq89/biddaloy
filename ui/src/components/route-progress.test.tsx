import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouteProgress } from './route-progress';

describe('RouteProgress', () => {
  it('exposes the translated label as its accessible name', () => {
    render(<RouteProgress active label="Loading" />);
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeTruthy();
  });

  it('is aria-busy and not aria-hidden while active', () => {
    render(<RouteProgress active label="Loading" />);
    const bar = screen.getByRole('progressbar', { hidden: true });
    expect(bar.getAttribute('aria-busy')).toBe('true');
    expect(bar.getAttribute('aria-hidden')).toBe('false');
  });

  it('is aria-hidden, not aria-busy, and stays mounted (opacity-0) when inactive', () => {
    const { container } = render(<RouteProgress active={false} label="Loading" />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toBeTruthy();
    expect(bar?.getAttribute('aria-hidden')).toBe('true');
    expect(bar?.getAttribute('aria-busy')).toBe('false');
    expect(bar?.className).toContain('opacity-0');
  });

  it('does not set aria-valuenow — this is an indeterminate progress indicator', () => {
    const { container } = render(<RouteProgress active label="Loading" />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('drives the travel animation off a CSS class, not an inline literal duration, and only while active', () => {
    const { container, rerender } = render(<RouteProgress active label="Loading" />);
    const track = container.querySelector('[role="progressbar"] > div');
    expect(track?.className).toContain('route-progress-bar-active');
    expect(track?.getAttribute('style')).toBeFalsy();

    rerender(<RouteProgress active={false} label="Loading" />);
    const idleTrack = container.querySelector('[role="progressbar"] > div');
    expect(idleTrack?.className).not.toContain('route-progress-bar-active');
  });
});
