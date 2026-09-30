import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BarWidget } from './bar-widget';
import { SummaryCard } from './summary-card';
import { SwipeRow } from './swipe-row';

describe('BarWidget', () => {
  it('exposes each bar value as text and to screen readers', () => {
    render(
      <BarWidget
        title="By subject"
        emptyLabel="Not enough data yet"
        bars={[{ label: 'Math', value: 82, valueLabel: '82%' }]}
      />,
    );
    expect(screen.getByText('82%')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Math' });
    expect(bar.getAttribute('aria-valuetext')).toBe('82%');
  });

  it('renders the empty label when there are no bars', () => {
    render(<BarWidget title="t" bars={[]} emptyLabel="Not enough data yet" />);
    expect(screen.getByText('Not enough data yet')).toBeTruthy();
  });

  it('renders error text as an alert', () => {
    render(<BarWidget title="t" bars={[]} emptyLabel="x" error="Could not load" />);
    expect(screen.getByRole('alert').textContent).toBe('Could not load');
  });

  it('announces loading', () => {
    render(<BarWidget title="t" bars={[]} emptyLabel="x" loading loadingLabel="Loading" />);
    expect(screen.getByText('Loading')).toBeTruthy();
  });
});

describe('SummaryCard', () => {
  it('pairs each figure label with its value', () => {
    render(
      <SummaryCard
        title="Overview"
        headline={{ label: 'Average', value: '82%' }}
        figures={[{ label: 'Exams', value: '4' }]}
      />,
    );
    expect(screen.getByText('82%')).toBeTruthy();
    expect(screen.getByText('Exams').tagName).toBe('DT');
  });

  it('shows the empty label without a headline', () => {
    render(<SummaryCard title="Overview" headline={null} emptyLabel="Not enough data yet" />);
    expect(screen.getByText('Not enough data yet')).toBeTruthy();
  });

  it('renders error text', () => {
    render(<SummaryCard title="o" headline={null} error="Could not load" />);
    expect(screen.getByRole('alert').textContent).toBe('Could not load');
  });
});

describe('SwipeRow', () => {
  it('is a labelled, focusable region', () => {
    render(
      <SwipeRow label="Performance widgets">
        <div>a</div>
      </SwipeRow>,
    );
    const region = screen.getByRole('region', { name: 'Performance widgets' });
    expect(region.getAttribute('tabindex')).toBe('0');
  });
});
