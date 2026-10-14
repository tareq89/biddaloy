import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LineChart, type LineChartPoint } from './line-chart';

const months = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const points: LineChartPoint[] = months.map((x, i) => ({
  x,
  y: 10 + i * 5,
  valueLabel: `v${i}`,
}));
const base = { label: 'Monthly collection', points, formatTick: (n: number) => `${n}%` };

describe('LineChart', () => {
  it('is an img named label with one path and one x label per point', () => {
    const { container } = render(<LineChart {...base} />);
    expect(screen.getByRole('img', { name: 'Monthly collection' })).toBeTruthy();
    expect(container.querySelectorAll('path[data-series]')).toHaveLength(1);
    months.forEach((m) => expect(screen.getByText(m)).toBeTruthy());
  });

  it('draws a dashed target line with its label', () => {
    const { container } = render(
      <LineChart {...base} target={{ value: 40, label: 'Target 40' }} />,
    );
    expect(screen.getByText('Target 40')).toBeTruthy();
    expect(
      container.querySelector('line[data-target]')!.getAttribute('stroke-dasharray'),
    ).toBeTruthy();
  });

  it('inProgressFrom makes the last segment a separate dotted path', () => {
    const { container } = render(<LineChart {...base} inProgressFrom={3} futureFrom={4} />);
    const paths = container.querySelectorAll('path[data-series]');
    expect(paths).toHaveLength(2);
    expect(paths[0]!.getAttribute('stroke-dasharray')).toBeNull();
    expect(paths[1]!.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('futureFrom drops markers and mutes the labels', () => {
    const { container } = render(<LineChart {...base} futureFrom={10} labelled={[0, 9, 10, 11]} />);
    expect(container.querySelector('circle[data-index="9"]')).not.toBeNull();
    expect(container.querySelector('circle[data-index="10"]')).toBeNull();
    expect(container.querySelector('circle[data-index="11"]')).toBeNull();
    expect(screen.getByText('K').getAttribute('class')).toContain('text-muted-foreground/50');
    expect(screen.getByText('L').getAttribute('class')).toContain('text-muted-foreground/50');
    expect(screen.getByText('A').getAttribute('class')).not.toContain('text-muted-foreground/50');
  });

  it('labelled indices get exactly those direct labels', () => {
    render(<LineChart {...base} labelled={[0, 9]} />);
    expect(screen.getAllByText(/^v\d+$/).map((e) => e.textContent)).toEqual(['v0', 'v9']);
  });

  it('keyboard moves the tooltip; End goes to last non-future; Escape clears', () => {
    render(<LineChart {...base} futureFrom={10} />);
    const plot = screen.getByRole('img');
    plot.focus();
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(screen.getByRole('tooltip').textContent).toBe('B: v1');
    fireEvent.keyDown(plot, { key: 'End' });
    expect(screen.getByRole('tooltip').textContent).toBe('J: v9');
    fireEvent.keyDown(plot, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('pointer near point 2 shows its tooltip', () => {
    const { container } = render(<LineChart {...base} />);
    const svg = container.querySelector('svg')!;
    const cx = Number(container.querySelector('[data-x-label="2"]')!.getAttribute('x'));
    const ev = createEvent.pointerMove(svg);
    Object.defineProperty(ev, 'clientX', { value: cx + 1 });
    fireEvent(svg, ev);
    expect(screen.getByRole('tooltip').textContent).toBe('C: v2');
    fireEvent.pointerLeave(svg);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('renders nothing without points', () => {
    const { container } = render(<LineChart {...base} points={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('is axe clean', async () => {
    const { container } = render(
      <LineChart {...base} target={{ value: 40, label: 'T' }} labelled={[0]} />,
    );
    await expect(container).toHaveNoViolations();
  });
});
