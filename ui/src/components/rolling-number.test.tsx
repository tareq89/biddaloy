import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RollingNumber } from './rolling-number';

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') && matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('RollingNumber', () => {
  it.each(['12,345', '১২,৩৪৫'])('renders %s as the exact same text, once, for readers', (value) => {
    const { container } = render(<RollingNumber value={value} />);
    expect(container.textContent).toBe(value);
    expect(screen.getByText(value).className).toContain('sr-only');
    const glyphs = [...container.querySelectorAll('[data-char]')].map((n) =>
      n.getAttribute('data-char'),
    );
    expect(glyphs.join('')).toBe(value);
  });

  it('animates digits only, staggered 100 ms apart, skipping separators', () => {
    const { container } = render(<RollingNumber value="1,২৩" />);
    const digits = [...container.querySelectorAll<HTMLElement>('[data-rolling-digit]')];
    expect(digits.map((d) => d.getAttribute('data-char'))).toEqual(['1', '২', '৩']);
    expect(digits.map((d) => d.style.transitionDelay)).toEqual(['0ms', '100ms', '200ms']);
  });

  it('adds no animation under reduced motion', () => {
    stubReducedMotion(true);
    const { container } = render(<RollingNumber value="1,234" />);
    expect(container.querySelector('[data-rolling-digit]')).toBeNull();
    expect(container.textContent).toBe('1,234');
  });
});
