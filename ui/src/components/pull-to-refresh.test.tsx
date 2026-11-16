import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PullToRefresh } from './pull-to-refresh';

const setMedia = (query: string, value: boolean) => {
  (window.matchMedia(query) as { matches: boolean }).matches = value;
};
afterEach(() => {
  setMedia('(pointer: coarse)', false);
  setMedia('(prefers-reduced-motion: reduce)', false);
});

const pull = (el: HTMLElement, distance: number) => {
  fireEvent.touchStart(el, { touches: [{ clientY: 0 }] });
  fireEvent.touchMove(el, { touches: [{ clientY: distance }] });
};
const setup = (onRefresh = vi.fn().mockResolvedValue(undefined)) => {
  setMedia('(pointer: coarse)', true);
  render(
    <PullToRefresh onRefresh={onRefresh} label="Refreshing">
      <p>row</p>
    </PullToRefresh>,
  );
  const area = screen.getByText('row').closest<HTMLElement>('[data-slot="pull-to-refresh"]')!;
  return { onRefresh, area };
};
const content = () => screen.getByText('row').parentElement!;

describe('PullToRefresh', () => {
  it('renders children only on desktop', () => {
    const { container } = render(
      <PullToRefresh onRefresh={vi.fn()} label="Refreshing">
        <p>row</p>
      </PullToRefresh>,
    );
    expect(container.querySelector('[data-slot="pull-to-refresh"]')).toBeNull();
    expect(screen.getByText('row')).toBeTruthy();
  });

  it('moves content 35% of the finger distance', () => {
    const { area } = setup();
    pull(area, 100);
    expect(content().style.transform).toBe('translateY(35px)');
  });

  it('does nothing below the threshold and springs back', () => {
    const { area, onRefresh } = setup();
    pull(area, 40);
    fireEvent.touchEnd(area);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(content().style.transform).toBe('');
  });

  it('calls onRefresh once past the threshold, showing the spinner meanwhile', async () => {
    const { area, onRefresh } = setup();
    pull(area, 120);
    fireEvent.touchEnd(area);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('reduced motion removes the translate', () => {
    setMedia('(prefers-reduced-motion: reduce)', true);
    const { area } = setup();
    pull(area, 100);
    expect(content().style.transform).toBe('');
  });
});
