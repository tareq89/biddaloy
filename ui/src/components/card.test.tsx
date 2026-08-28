import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Card } from './card';

describe('Card', () => {
  it('renders its children inside a surface div', () => {
    render(<Card>Card content</Card>);

    const card = screen.getByText('Card content');
    expect(card.tagName).toBe('DIV');
    expect(card.getAttribute('data-slot')).toBe('card');
    // §4's resting-card recipe: subtle outline + surface fill + e1 lift.
    expect(card.className).toContain('border-border-subtle');
    expect(card.className).toContain('bg-card');
    expect(card.className).toContain('shadow-e1');
  });

  it('merges a caller className with the base surface classes rather than replacing them', () => {
    render(<Card className="p-4">Padded</Card>);

    const card = screen.getByText('Padded');
    expect(card.className).toContain('p-4');
    expect(card.className).toContain('bg-card');
    expect(card.className).toContain('shadow-e1');
  });

  /** The base string bakes in `shadow-e1`, so a caller asking for a flat card
   * must actually *displace* it — not merely emit a competing class and hope
   * `.shadow-none` sorts after `.shadow-e1` in the compiled stylesheet. That
   * depends on `cn`'s tailwind-merge config knowing the elevation scale; see
   * `../primitives/lib/utils.ts`. */
  it('lets a caller flatten the card by dropping shadow-e1, not just appending shadow-none', () => {
    render(<Card className="shadow-none">Flat</Card>);

    const card = screen.getByText('Flat');
    expect(card.className).toContain('shadow-none');
    expect(card.className).not.toContain('shadow-e1');
  });

  it('lets a caller raise the card to a higher elevation step', () => {
    render(<Card className="shadow-e3">Lifted</Card>);

    const card = screen.getByText('Lifted');
    expect(card.className).toContain('shadow-e3');
    expect(card.className).not.toContain('shadow-e1');
  });

  it('asChild merges the surface onto the single child element', () => {
    render(
      <Card asChild>
        <a href="/portal">Whole card is a link</a>
      </Card>,
    );

    const link = screen.getByRole('link', { name: 'Whole card is a link' });
    expect(link.tagName).toBe('A');
    expect(link.className).toContain('rounded-lg');
    // No wrapper div left behind — the anchor itself is the surface.
    expect(document.querySelectorAll('[data-slot="card"]').length).toBe(1);
  });

  it('forwards arbitrary div props', () => {
    render(<Card aria-label="Summary">Surface</Card>);

    expect(screen.getByLabelText('Summary')).toBeTruthy();
  });
});
