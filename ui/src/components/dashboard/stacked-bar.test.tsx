import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StackedBar, type StackedBarSegment } from './stacked-bar';

const segs: StackedBarSegment[] = [
  {
    id: 'cash',
    label: 'Cash',
    value: 60,
    valueLabel: '৳6,000',
    detail: '11 payments',
    color: 'cat-1',
  },
  { id: 'bkash', label: 'bKash', value: 30, valueLabel: '৳3,000', color: 'cat-2' },
  { id: 'bank', label: 'Bank', value: 0, valueLabel: '৳0', color: 'cat-3' },
];

describe('StackedBar', () => {
  it('accessible name contains every segment label and value', () => {
    render(<StackedBar label="Today" segments={segs} />);
    const name = screen.getByRole('img', { name: /Today/ }).getAttribute('aria-label')!;
    for (const s of segs) expect(name).toContain(`${s.label} ${s.valueLabel}`);
  });

  it('segments use flex-grow, skip zero values, carry bg classes', () => {
    render(<StackedBar label="Today" segments={segs} />);
    const parts = screen.getAllByTestId('stacked-bar-segment');
    expect(parts).toHaveLength(2);
    expect(parts[0]!.style.flexGrow).toBe('60');
    expect(parts[0]!.className).toContain('bg-chart-cat-1');
    expect(parts[1]!.className).toContain('bg-chart-cat-2');
    expect(parts[0]!.getAttribute('title')).toBe('Cash: ৳6,000');
  });

  it('legend shows label, value and detail; legend=false hides it', () => {
    const { rerender } = render(<StackedBar label="Today" segments={segs} />);
    expect(screen.getByText('11 payments')).toBeTruthy();
    expect(screen.getAllByText('৳6,000')).toHaveLength(1);
    rerender(<StackedBar label="Today" segments={segs} legend={false} />);
    expect(screen.queryByText('11 payments')).toBeNull();
  });

  it('all zero renders the muted track', () => {
    render(<StackedBar label="Today" segments={segs.map((s) => ({ ...s, value: 0 }))} />);
    expect(screen.queryAllByTestId('stacked-bar-segment')).toHaveLength(0);
    expect(screen.getByTestId('stacked-bar-track').className).toContain('bg-muted');
  });

  it('is axe clean', async () => {
    const { container } = render(<StackedBar label="Today" segments={segs} />);
    await expect(container).toHaveNoViolations();
  });
});
