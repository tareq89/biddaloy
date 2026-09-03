import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton, SkeletonFieldList, SkeletonTable, SkeletonText } from './skeleton';

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

  it('[8.14.12] fades in on arrival, bound to the base motion token', () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector('[data-slot="skeleton"]');
    // NOT `animate-in`/`fade-in-0`: that utility compiles to a full
    // `animation` shorthand, same property `animate-pulse` sets, and
    // Tailwind's alphabetical utility order makes `animate-pulse` always
    // win — combining the two would silently no-op the fade. A
    // `transition-opacity` + `@starting-style` pair uses a different CSS
    // property, so it composes with the pulse instead of losing to it.
    expect(el?.className).toContain('starting:opacity-0');
    expect(el?.className).toContain('opacity-100');
    expect(el?.className).toContain('transition-opacity');
    expect(el?.className).toContain('duration-(--motion-duration-base)');
    expect(el?.className).toContain('ease-(--motion-ease-standard)');
    // the infinite-loop `animate-pulse` backstop must survive alongside it.
    expect(el?.className).toContain('animate-pulse');
    expect(el?.className).toContain('motion-reduce:animate-none');
  });

  it('forwards arbitrary props (e.g. aria-label for a labelled placeholder)', () => {
    const { container } = render(<Skeleton aria-label="Loading student list" />);
    expect(container.querySelector('[aria-label="Loading student list"]')).toBeTruthy();
  });
});

describe('SkeletonText', () => {
  it('renders one placeholder per line of the content it stands in for', () => {
    const { container } = render(<SkeletonText lines={5} />);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(5);
  });

  it('defaults to the three-line shape the route helpers used to hand-roll', () => {
    const { container } = render(<SkeletonText />);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
  });

  it('shortens only the last line, so a paragraph does not read as a bar chart', () => {
    const { container } = render(<SkeletonText lines={3} />);
    const lines = [...container.querySelectorAll('[data-slot="skeleton"]')];
    expect(lines.slice(0, -1).every((line) => line.className.includes('w-full'))).toBe(true);
    expect(lines.at(-1)?.className).toContain('w-2/3');
    expect(lines.at(-1)?.className).not.toContain('w-full');
  });

  it('keeps a single line full width — there is no earlier line for it to be shorter than', () => {
    const { container } = render(<SkeletonText lines={1} />);
    const only = container.querySelector('[data-slot="skeleton"]');
    expect(only?.className).toContain('w-full');
  });

  it('is hidden from assistive tech — the caller announces loading, not a stack of grey boxes', () => {
    const { container } = render(<SkeletonText />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps every line on the reduced-motion-safe base Skeleton', () => {
    const { container } = render(<SkeletonText lines={2} />);
    for (const line of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(line.className).toContain('motion-reduce:animate-none');
    }
  });
});

describe('SkeletonTable', () => {
  it('renders the requested grid of rows and columns', () => {
    const { container } = render(<SkeletonTable rows={3} columns={4} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(container.querySelectorAll('thead th')).toHaveLength(4);
    expect(container.querySelectorAll('tbody td')).toHaveLength(12);
  });

  it('is built from the real table markup, so its rows are the height of the rows that replace them', () => {
    const { container } = render(<SkeletonTable rows={1} columns={1} />);
    // `p-2` on the cell and `h-10` on the header come from `table.tsx`
    // itself — that is the point: the geometry cannot drift from the real
    // table because it *is* the real table.
    expect(container.querySelector('[data-slot="table-cell"]')?.className).toContain('p-2');
    expect(container.querySelector('[data-slot="table-head"]')?.className).toContain('h-10');
  });

  it('is hidden from assistive tech rather than announced as a table of empty cells', () => {
    const { container } = render(<SkeletonTable />);
    expect(container.querySelector('table')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is axe clean', async () => {
    const { container } = render(<SkeletonTable rows={2} columns={3} />);
    await expect(container).toHaveNoViolations();
  });
});

describe('SkeletonFieldList', () => {
  it('renders a label and a value placeholder per field', () => {
    const { container } = render(<SkeletonFieldList fields={4} />);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(8);
  });

  it("lays out on the same grid the detail tabs' own <dl> uses", () => {
    const { container } = render(<SkeletonFieldList />);
    const root = container.firstElementChild;
    expect(root?.className).toContain('grid-cols-2');
    expect(root?.className).toContain('sm:grid-cols-4');
  });

  it('is hidden from assistive tech', () => {
    const { container } = render(<SkeletonFieldList />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is axe clean', async () => {
    const { container } = render(<SkeletonFieldList />);
    await expect(container).toHaveNoViolations();
  });
});
