import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectKeyboardOperable, LINK_KEYS } from '../test/a11y';

import { SkipLink } from './skip-link';

describe('SkipLink', () => {
  it('is hidden by default (sr-only) but not from the accessibility tree', () => {
    render(<SkipLink targetId="main-content">Skip to main content</SkipLink>);
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link.className).toContain('sr-only');
  });

  it('points at the given target id', () => {
    render(<SkipLink targetId="main-content">Skip to main content</SkipLink>);
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link.getAttribute('href')).toBe('#main-content');
  });

  it('is the first Tab stop and activates via Enter, like any native link', async () => {
    render(
      <div>
        <SkipLink targetId="main-content">Skip to main content</SkipLink>
        <a href="#somewhere-else">Somewhere else</a>
      </div>,
    );
    await expectKeyboardOperable(screen.getByRole('link', { name: 'Skip to main content' }), {
      keys: LINK_KEYS,
    });
  });

  it('is axe clean', async () => {
    const { container } = render(<SkipLink targetId="main-content">Skip to main content</SkipLink>);
    await expect(container).toHaveNoViolations();
  });
});
