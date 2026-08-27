import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Card } from './card';

describe('Card', () => {
  it('renders its children inside a surface div', () => {
    render(<Card>Card content</Card>);

    const card = screen.getByText('Card content');
    expect(card.tagName).toBe('DIV');
    expect(card.getAttribute('data-slot')).toBe('card');
    expect(card.className).toContain('border-border');
  });

  it('merges a caller className with the base surface classes rather than replacing them', () => {
    render(<Card className="p-4">Padded</Card>);

    const card = screen.getByText('Padded');
    expect(card.className).toContain('p-4');
    expect(card.className).toContain('bg-background');
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
