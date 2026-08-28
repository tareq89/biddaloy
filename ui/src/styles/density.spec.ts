import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Density ([8.13.8], design contract §6). Two numeric modes selected by a
 * `data-density` attribute and one CSS variable — no component prop changes.
 *
 * `scripts/check-contrast.mjs` already proves the variable survives Tailwind
 * compilation and that the utilities reading it emit real rules. What it
 * cannot see is the DECISION side: which fallback belongs to which size
 * variant. Those eight numbers are the compact heights every staff route
 * still renders at, and they are load-bearing in the one direction nobody
 * looks — a fallback typo leaves `/portal` perfect (it never reads the
 * fallback) while silently resizing every admin table control.
 *
 * So this spec reads the primitives as source text and pins the mapping to
 * §6's table. Reading source rather than rendering is deliberate: jsdom does
 * not apply the stylesheet or resolve custom properties, so an assertion on
 * a rendered `getComputedStyle().height` would pass no matter what these
 * classes said. The class string IS the behaviour here, and it is the thing
 * a careless edit changes.
 */
const stylesDir = dirname(fileURLToPath(import.meta.url));
const primitivesDir = join(stylesDir, '..', 'primitives');
const read = (file: string) => readFileSync(join(primitivesDir, file), 'utf8');
const componentsDir = join(stylesDir, '..', 'components');
const readComponent = (file: string) => readFileSync(join(componentsDir, file), 'utf8');

/**
 * `globals.css` with comments removed. The comments deliberately SPELL OUT
 * the shapes these assertions ban — the density note explains why there is
 * no `:root` default by writing one out — so a naive read of the file
 * matches its own documentation and fails.
 */
const globalsCss = () => readFileSync(join(stylesDir, 'globals.css'), 'utf8');
const globalsRules = () => globalsCss().replace(/\/\*[\s\S]*?\*\//g, '');

/** The comfortable value, from §6: 2.75rem = 44px = WCAG 2.2 SC 2.5.5. */
const COMFORTABLE = '2.75rem';

describe('density mechanism (design contract §6)', () => {
  it('declares the comfortable mode on an attribute, never on :root', () => {
    const css = globalsRules();

    expect(css).toContain(`[data-density='comfortable']`);
    expect(css).toContain(`--control-h: ${COMFORTABLE};`);

    // Compact is the default BY ABSENCE. A `:root { --control-h: … }` would
    // shadow all eight per-variant fallbacks with one number and hand every
    // staff route the portal's target sizes.
    expect(css).not.toMatch(/:root\s*\{[^}]*--control-h/);
  });

  it('sets no density variable in the dark block — a target does not resize by theme', () => {
    const css = globalsRules();
    const darkBlock = /:root\[data-theme=["']dark["']\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(darkBlock).not.toContain('--control-h');
    expect(darkBlock).not.toContain('--target-inset');
  });
});

describe('per-variant control heights (design contract §6 mapping table)', () => {
  /** [size variant, the compact height it must keep via its var() fallback] */
  const BUTTON_SIZES: [string, string][] = [
    ['default', '2rem'], // 32px
    ['xs', '1.5rem'], // 24px
    ['sm', '1.75rem'], // 28px
    ['lg', '2.25rem'], // 36px
  ];
  const BUTTON_ICON_SIZES: [string, string][] = [
    ['icon', '2rem'],
    ['icon-xs', '1.5rem'],
    ['icon-sm', '1.75rem'],
    ['icon-lg', '2.25rem'],
  ];

  it.each(BUTTON_SIZES)('button size %s keeps %s as its compact fallback', (_size, fallback) => {
    expect(read('button.tsx')).toContain(`h-[var(--control-h,${fallback})]`);
  });

  it.each(BUTTON_ICON_SIZES)('button size %s keeps %s as its compact fallback', (_s, fallback) => {
    expect(read('button.tsx')).toContain(`size-[var(--control-h,${fallback})]`);
  });

  it('covers all eight button size variants and leaves no literal height behind', () => {
    const sizeBlock = /size:\s*\{([\s\S]*?)\n\s*\},/.exec(read('button.tsx'))?.[1] ?? '';

    expect(sizeBlock).not.toBe('');
    expect([...sizeBlock.matchAll(/(?:h|size)-\[var\(--control-h,/g)]).toHaveLength(8);
    // A literal `h-8`/`size-9` surviving in the size block means one variant
    // was missed and is frozen at compact on `/portal`. The lookbehind skips
    // the nested `[&_svg:not([class*='size-'])]:size-3` icon rules, which set
    // a glyph's size and have nothing to do with the control's height.
    expect(sizeBlock).not.toMatch(/(?<![:\w-])(?:h|size)-\d/);
  });

  it('lifts the input with the same 32px fallback as a default button', () => {
    expect(read('input.tsx')).toContain('h-[var(--control-h,2rem)]');
  });

  /**
   * The select trigger was NOT in §6's first mapping table — it carries its
   * height on a `data-[size=…]` variant rather than a plain class, so a read
   * of the table missed it. Pinned here so it cannot be missed twice.
   */
  /**
   * `TabsList` was in neither §6's first mapping table nor its "not in
   * scope" list — silently unhandled rather than deliberately deferred. No
   * `/portal` route renders `Tabs` today, so the 44px e2e gate would not
   * have caught it; the first tabbed guardian screen would simply have
   * shipped 26px triggers under a contract promising 44px.
   */
  it('lifts the horizontal tabs list', () => {
    const tabs = read('tabs.tsx');

    expect(tabs).toContain('group-data-[orientation=horizontal]/tabs:h-[var(--control-h,2rem)]');
    expect(tabs).not.toContain('group-data-[orientation=horizontal]/tabs:h-8');
  });

  it('lifts both select trigger sizes', () => {
    const select = read('select.tsx');
    expect(select).toContain('data-[size=default]:h-[var(--control-h,2rem)]');
    expect(select).toContain('data-[size=sm]:h-[var(--control-h,1.75rem)]');
  });
});

describe('checkbox and radio hit areas (design contract §6)', () => {
  /**
   * These two keep their 16px visible box in both modes — a 44px checkbox
   * would read as a button. The target grows instead, via the negative-inset
   * `::after` they already use: 16 + 2x14 = 44 under comfortable, and the
   * asymmetric 40x32 they ship today under compact.
   */
  it.each(['checkbox.tsx', 'radio-group.tsx'])('%s grows its ::after, not its box', (file) => {
    const source = read(file);

    expect(source).toContain('size-4');
    expect(source).toContain('after:-inset-x-[var(--target-inset,0.75rem)]');
    expect(source).toContain('after:-inset-y-[var(--target-inset,0.5rem)]');
    // The fixed insets these replaced would pass a 24px gate and fail a 44px one.
    expect(source).not.toContain('after:-inset-x-3 after:-inset-y-2');
  });

  it('sizes the comfortable inset so a 16px box reaches exactly 44px', () => {
    const css = globalsRules();
    const inset = /--target-inset:\s*([\d.]+)rem/.exec(css)?.[1];

    expect(inset).toBeDefined();
    expect(1 + Number(inset) * 2).toBeCloseTo(Number(COMFORTABLE.replace('rem', '')));
  });
});

/**
 * The one control that must NOT simply take `--control-h`.
 *
 * `sign-in-form.tsx`'s show/hide password toggle is absolutely positioned
 * INSIDE the password field. Under compact it was a 28px `size="sm"` button
 * in a 32px input — 2px of clearance per side. Once both sides read the same
 * variable they became 44px in a 44px field, and the ghost variant's hover
 * background painted straight over the input's top and bottom borders and
 * its rounded end corner, on `/login`, the one route this PR made
 * comfortable by default.
 *
 * The fix is to DERIVE the height instead of sharing it, and to give the
 * 4px back as hit area with the same negative-inset `::after` pattern
 * `checkbox.tsx` uses and `e2e/responsive/target-size.spec.ts` knows how to
 * measure — so the painted button is 40px inside a 44px field while the tap
 * target is the full 44px.
 *
 * This is the general hazard of a single global `--control-h`: any layout
 * that relied on `sm` being smaller than `default` collapses when both
 * resolve to the same number. This is the only live instance today.
 */
describe('inset controls (design contract §6)', () => {
  const signInForm = () => readComponent('sign-in-form.tsx');

  it('derives the password toggle height from the field rather than matching it', () => {
    expect(signInForm()).toContain('h-[calc(var(--control-h,2rem)-0.25rem)]');
    // Sharing the field's own height is the regression: a full-height ghost
    // button paints over the borders it is supposed to sit inside.
    expect(signInForm()).not.toContain('h-[var(--control-h,2rem)]');
  });

  it('gives the inset back as hit area so the target is still 44px', () => {
    const source = signInForm();

    // `inset-x-0` matters: an `inset-y`-only absolutely positioned ::after
    // is zero-wide and receives no clicks at all, so the extension would be
    // real to the e2e measurer and imaginary to a finger.
    expect(source).toContain('after:absolute after:inset-x-0 after:-inset-y-[0.125rem]');
  });
});
