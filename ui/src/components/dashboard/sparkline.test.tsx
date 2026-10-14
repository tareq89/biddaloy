import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Sparkline } from './sparkline';

const pts = (c: HTMLElement) =>
  c.querySelector('polyline')!.getAttribute('points')!.trim().split(/\s+/);

describe('Sparkline', () => {
  it('is an img named label with one point per value', () => {
    const { container } = render(<Sparkline values={[1, 3, 2, 5]} label="Trend" />);
    expect(screen.getByRole('img', { name: 'Trend' })).toBeTruthy();
    expect(pts(container)).toHaveLength(4);
  });
  it('renders nothing for fewer than 2 values', () => {
    const { container } = render(<Sparkline values={[1]} label="x" />);
    expect(container.firstChild).toBeNull();
  });
  it('flat series has equal y', () => {
    const { container } = render(<Sparkline values={[4, 4, 4]} label="x" />);
    expect(new Set(pts(container).map((p) => p.split(',')[1])).size).toBe(1);
  });
  it('showLastDot adds one circle at the last point', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} label="x" showLastDot />);
    const c = container.querySelectorAll('circle');
    expect(c).toHaveLength(1);
    const [x, y] = pts(container)[2]!.split(',');
    expect(c[0]!.getAttribute('cx')).toBe(x);
    expect(c[0]!.getAttribute('cy')).toBe(y);
  });
  it('is axe clean', async () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} label="Trend" showLastDot />);
    await expect(container).toHaveNoViolations();
  });
});
