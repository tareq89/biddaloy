import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { ColumnChart, type ColumnChartProps } from './column-chart';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const single: ColumnChartProps = {
  label: 'Enrollment, 5 years',
  series: [{ id: 'n', label: 'Admissions', color: 'primary' }],
  data: [10, 20, 30, 40, 50].map((v, i) => ({
    x: `Y${i}`,
    values: { n: v },
    valueLabels: { n: `${v}` },
  })),
  formatTick: (n) => String(n),
};
const stacked: ColumnChartProps = {
  label: 'Collected vs outstanding',
  series: [
    { id: 'c', label: 'Collected', color: 'primary' },
    { id: 'd', label: 'Outstanding', color: 'cat-2' },
  ],
  data: [
    { x: 'Jan', values: { c: 30, d: 10 }, valueLabels: { c: '30', d: '10' } },
    { x: 'Feb', values: { c: 20, d: 0 }, valueLabels: { c: '20', d: '0' } },
  ],
  formatTick: (n) => String(n),
};
const segs = (c: HTMLElement) => c.querySelectorAll('[data-segment]');

describe('ColumnChart', () => {
  it('is an img named label with one mark per column', () => {
    const { container } = render(<ColumnChart {...single} />);
    expect(screen.getByRole('img', { name: single.label })).toBeTruthy();
    expect(segs(container)).toHaveLength(5);
  });
  it('stacked draws a segment per non-zero value', () => {
    const { container } = render(<ColumnChart {...stacked} />);
    expect(segs(container)).toHaveLength(3);
  });
  it('highlightIndex uses series fill, others muted', () => {
    const { container } = render(<ColumnChart {...single} highlightIndex={4} />);
    const s = [...segs(container)];
    expect(s[4]!.getAttribute('class')).toContain('fill-primary');
    expect(s[0]!.getAttribute('class')).toContain('fill-muted-foreground');
  });
  it('stacked heights add up taller than either part', () => {
    const { container } = render(<ColumnChart {...stacked} />);
    const h = (e: Element) => Number(e.getAttribute('data-h'));
    const [c, d, f] = [...segs(container)];
    expect(h(c!) + h(d!)).toBeGreaterThan(h(f!));
  });
  it('legend only for 2+ series', () => {
    const a = render(<ColumnChart {...single} />);
    expect(a.container.querySelector('ul')).toBeNull();
    a.unmount();
    render(<ColumnChart {...stacked} />);
    expect(screen.getByText('Collected')).toBeTruthy();
    expect(screen.getByText('Outstanding')).toBeTruthy();
  });
  it('labelled shows value labels only for that column', () => {
    const { container } = render(<ColumnChart {...single} labelled={[4]} />);
    const t = [...container.querySelectorAll('[data-value-label]')].map((e) => e.textContent);
    expect(t).toEqual(['50']);
  });
  it('ArrowRight moves tooltip to column 1 naming every series', () => {
    render(<ColumnChart {...stacked} />);
    const plot = screen.getByRole('img', { name: stacked.label });
    fireEvent.focus(plot);
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    const tip = screen.getByRole('status').textContent;
    expect(tip).toContain('Feb');
    expect(tip).toContain('Collected');
    expect(tip).toContain('Outstanding');
  });
  it('all zeros: no crash, ticks start at 0', () => {
    const data = single.data.map((d) => ({ ...d, values: { n: 0 }, valueLabels: { n: '0' } }));
    const { container } = render(<ColumnChart {...single} data={data} />);
    expect(container.querySelectorAll('[data-tick]')[0]!.textContent).toBe('0');
  });
  it('is axe clean', async () => {
    const { container } = render(<ColumnChart {...stacked} labelled={[0]} currentIndex={0} />);
    await expect(container).toHaveNoViolations();
  });
});
