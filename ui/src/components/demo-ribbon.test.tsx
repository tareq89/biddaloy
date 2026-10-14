import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppHeader } from './app-header';
import { DemoRibbon } from './demo-ribbon';

describe('DemoRibbon', () => {
  it('renders a note with the label and the visible text DEMO', () => {
    render(<DemoRibbon label="Demo school" />);
    const note = screen.getByRole('note', { name: 'Demo school' });
    expect(note.textContent).toBe('DEMO');
  });

  it('ignores pointers and hides on print', () => {
    render(<DemoRibbon label="Demo school" />);
    const cls = screen.getByRole('note').className;
    expect(cls).toContain('pointer-events-none');
    expect(cls).toContain('print:hidden');
  });

  it('is axe clean', async () => {
    const { baseElement } = render(<DemoRibbon label="Demo school" />);
    await expect(baseElement).toHaveNoViolations();
  });
});

describe('AppHeader reserveCorner', () => {
  const props = { start: <span>School</span>, end: <button>Search</button> };

  it('adds the corner padding only when asked', () => {
    const { rerender } = render(<AppHeader {...props} reserveCorner />);
    expect(screen.getByRole('banner').className).toContain('pr-16 md:pr-24');
    rerender(<AppHeader {...props} />);
    expect(screen.getByRole('banner').className).not.toContain('pr-16');
  });
});
