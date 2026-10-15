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

describe('BarWidget target / emphasis / bare', () => {
  const bars = [
    { label: 'Class 1', value: 41, valueLabel: '41%', highlight: true, note: '19% behind' },
    { label: 'Class 2', value: 70, valueLabel: '70%' },
  ];
  const target = { value: 60, label: 'Expected today 60%' };

  it('draws a target marker per bar and one legend label', () => {
    render(<BarWidget title="t" bars={bars} emptyLabel="x" target={target} />);
    const markers = screen.getAllByTestId('bar-target');
    expect(markers).toHaveLength(2);
    expect(markers[0]!.style.left).toBe('60%');
    expect(screen.getAllByText('Expected today 60%')).toHaveLength(1);
    expect(
      screen.getByRole('progressbar', { name: 'Class 1' }).getAttribute('aria-valuetext'),
    ).toBe('41%, Expected today 60%');
  });

  it('emphasis=highlighted mutes the others; default keeps all primary', () => {
    const { rerender } = render(<BarWidget title="t" bars={bars} emptyLabel="x" />);
    expect(screen.getAllByTestId('bar-fill').every((f) => f.className.includes('bg-primary'))).toBe(
      true,
    );
    rerender(<BarWidget title="t" bars={bars} emptyLabel="x" emphasis="highlighted" />);
    const [a, b] = screen.getAllByTestId('bar-fill');
    expect(a!.className).toContain('bg-primary');
    expect(b!.className).toContain('bg-muted-foreground');
    expect(screen.getByText('41%').className).toContain('font-semibold');
  });

  it('renders note after the value', () => {
    render(<BarWidget title="t" bars={bars} emptyLabel="x" />);
    expect(screen.getByText('19% behind').className).toContain('text-muted-foreground');
  });

  it('bare has no card but still renders bars', () => {
    const { container } = render(<BarWidget bare bars={bars} emptyLabel="x" />);
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('is axe clean with target + highlight', async () => {
    const { container } = render(
      <BarWidget title="t" bars={bars} emptyLabel="x" target={target} emphasis="highlighted" />,
    );
    await expect(container).toHaveNoViolations();
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
