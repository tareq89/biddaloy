import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../test';

import { SuccessTick } from './success-tick';

describe('SuccessTick', () => {
  it('announces the label in a status region and is axe clean', async () => {
    const { container } = renderWithProviders(<SuccessTick label="Saved" />);
    expect((await screen.findByRole('status')).textContent).toBe('Saved');
    await expect(container).toHaveNoViolations();
  });

  it('falls back to a non-empty success title when no label is given', async () => {
    renderWithProviders(<SuccessTick />);
    expect((await screen.findByRole('status')).textContent?.length).toBeGreaterThan(0);
  });

  it('renders the circle and tick, timed off the confirm token (circle 60%, tick 40% after it)', () => {
    const { container } = render(<SuccessTick label="Saved" />);
    const circle = container.querySelector('circle') as SVGElement;
    const tick = container.querySelector('path') as SVGElement;
    expect(circle.style.transitionDuration).toContain('--motion-duration-confirm) * 0.6');
    expect(tick.style.transitionDuration).toContain('--motion-duration-confirm) * 0.4');
    expect(tick.style.transitionDelay).toContain('--motion-duration-confirm) * 0.6');
  });

  it('uses no animation class, so reduced motion (tokens at 0ms) lands on the final state at once', () => {
    const { container } = render(<SuccessTick label="Saved" />);
    expect(container.innerHTML).not.toMatch(/animate-|motion-reduce/);
  });
});
