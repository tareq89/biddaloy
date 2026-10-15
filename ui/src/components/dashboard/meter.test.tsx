import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Meter } from './meter';

const fill = (c: HTMLElement) => (c.querySelector('[data-meter-fill]') as HTMLElement).style.width;

describe('Meter', () => {
  it('exposes meter ARIA incl. marker label in valuetext', () => {
    render(
      <Meter
        label="Collection"
        value={70}
        max={100}
        valueText="70%"
        marker={{ value: 65, label: 'Last month 65%' }}
      />,
    );
    const m = screen.getByRole('meter', { name: 'Collection' });
    expect(m.getAttribute('aria-valuemin')).toBe('0');
    expect(m.getAttribute('aria-valuemax')).toBe('100');
    expect(m.getAttribute('aria-valuenow')).toBe('70');
    expect(m.getAttribute('aria-valuetext')).toBe('70%, Last month 65%');
  });
  it('clamps the fill', () => {
    const f = (value: number, max: number) =>
      fill(render(<Meter label="l" value={value} max={max} valueText="v" />).container);
    expect(f(70, 100)).toBe('70%');
    expect(f(130, 100)).toBe('100%');
    expect(f(5, 0)).toBe('0%');
  });
  it('places the marker', () => {
    const { container } = render(
      <Meter label="l" value={70} max={100} valueText="v" marker={{ value: 65, label: 'm' }} />,
    );
    expect((container.querySelector('[data-meter-marker]') as HTMLElement).style.left).toBe('65%');
  });
  it('showText=false hides text but keeps ARIA', () => {
    render(
      <Meter label="l" value={4} max={12} valueText="4 / 12" endText="of 12" showText={false} />,
    );
    expect(screen.queryByText('4 / 12')).toBeNull();
    expect(screen.queryByText('of 12')).toBeNull();
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toBe('4 / 12');
  });
  it('is axe clean', async () => {
    const { container } = render(
      <Meter
        label="l"
        value={70}
        max={100}
        valueText="70%"
        endText="goal"
        marker={{ value: 65, label: 'm' }}
      />,
    );
    await expect(container).toHaveNoViolations();
  });
});
