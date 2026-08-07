import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from './skeleton';

describe('Skeleton', () => {
  it('renders a placeholder element', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    const el = container.querySelector('[data-slot="skeleton"]');
    expect(el).toBeTruthy();
  });

  it('pairs the pulse animation with a motion-reduce override', () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector('[data-slot="skeleton"]');
    expect(el?.className).toContain('animate-pulse');
    expect(el?.className).toContain('motion-reduce:animate-none');
  });

  it('forwards arbitrary props (e.g. aria-label for a labelled placeholder)', () => {
    const { container } = render(<Skeleton aria-label="Loading student list" />);
    expect(container.querySelector('[aria-label="Loading student list"]')).toBeTruthy();
  });
});
