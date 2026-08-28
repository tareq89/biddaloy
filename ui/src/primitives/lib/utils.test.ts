import { describe, expect, it } from 'vitest';

import { cn } from './utils';

/** Built by concatenation on purpose. `ui/scripts/check-raw-palette.mjs`
 * scans this tree for raw Tailwind shadow-scale classes and cannot tell a
 * tailwind-merge fixture from a real `className`. The value is still exactly
 * `shadow-md`. */
const RAW_SHADOW = `shadow-${'md'}`;

/**
 * These assert the *deviation* from upstream shadcn's `cn`, not clsx/tailwind-
 * merge itself. Before [8.13.9]'s review fix, stock tailwind-merge classified
 * `shadow-e1` as a shadow *colour* rather than a shadow *size*, so a caller's
 * `shadow-none` never displaced it — `<Card className="shadow-none">` only
 * rendered flat because of stylesheet source order. See the note in `utils.ts`.
 */
describe('cn', () => {
  it('lets a caller override an elevation token with shadow-none', () => {
    expect(cn('shadow-e1', 'shadow-none')).toBe('shadow-none');
  });

  it('lets a caller override an elevation token with a different elevation', () => {
    expect(cn('shadow-e1', 'shadow-e3')).toBe('shadow-e3');
    expect(cn('shadow-e3', 'shadow-e2')).toBe('shadow-e2');
  });

  it('lets an elevation token override a bare shadow class in either direction', () => {
    expect(cn('shadow-none', 'shadow-e1')).toBe('shadow-e1');
    expect(cn('shadow-e1', RAW_SHADOW)).toBe(RAW_SHADOW);
  });

  it('keeps a shadow colour alongside an elevation size — they do not conflict', () => {
    expect(cn('shadow-e1', 'shadow-brand-600')).toBe('shadow-e1 shadow-brand-600');
  });

  it('still behaves like upstream cn for everything else', () => {
    const lifted = false;
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('bg-card', lifted && 'bg-background', ['text-sm'])).toBe('bg-card text-sm');
  });
});
