import { describe, expect, it } from 'vitest';

import { CONTRAST_PAIRS, dark, light, neutral, shadows } from '../../tailwind.preset';

/** Every `/ 0.NN` alpha in a shadow string, in order. */
function alphasOf(shadow: string): number[] {
  return [...shadow.matchAll(/\/\s*([\d.]+)\)/g)].map((match) => Number(match[1]));
}

/**
 * The two border roles from design contract §4. `check-contrast.mjs` already
 * guards that `globals.css` and the preset agree on the *value*; this spec
 * guards the *decisions* — which scale entry each role points at, and the
 * deliberate absence of a contrast pair for the subtle one.
 */
describe('border roles (design contract §4)', () => {
  it('routes the decorative role at neutral-200 in light and neutral-700 in dark', () => {
    expect(light.borderSubtle).toBe(neutral[200]);
    expect(dark.borderSubtle).toBe(neutral[700]);
  });

  it('leaves the functional role on neutral-500 in both themes', () => {
    expect(light.border).toBe(neutral[500]);
    expect(dark.border).toBe(neutral[500]);
  });

  it('holds both functional-border pairs to 3:1', () => {
    const functionalPairs = CONTRAST_PAIRS.filter(
      (pair) => pair.fg === light.border && (pair.bg === light.bg || pair.bg === dark.bg),
    );

    expect(functionalPairs).toHaveLength(2);
    for (const pair of functionalPairs) {
      expect(pair.min).toBe(3);
    }
  });

  /**
   * The subtle border is decoration: it never marks where a control begins
   * and ends and never conveys state, so SC 1.4.11's 3:1 does not apply and
   * it has no CONTRAST_PAIRS row. That absence is a decision, not an
   * oversight — without this test a well-meaning "we forgot one" fix would
   * add a pair that fails at ~1.2:1, and the exemption rationale would be
   * lost with it. If this test fails, re-read design contract §4 before
   * changing anything.
   */
  it('deliberately has no contrast pair for the subtle border', () => {
    // `pair.fg` is a union of the literals actually used today, which does
    // not include either subtle value — so TypeScript rejects a direct `===`
    // as a comparison with no overlap. Widening to `string` keeps this a
    // runtime assertion that still fails the moment someone adds the pair.
    const subtleValues: string[] = [light.borderSubtle, dark.borderSubtle];
    const subtlePairs = CONTRAST_PAIRS.filter((pair) => subtleValues.includes(pair.fg as string));

    expect(subtlePairs).toEqual([]);
  });
});

/**
 * Elevation, design contract §5. As with the border roles above,
 * `check-contrast.mjs` guards the *values* against globals.css; this spec
 * guards the *decisions* — how many steps there are, and that the dark half
 * was designed rather than copied.
 */
describe('elevation scale (design contract §5)', () => {
  it('is exactly three steps, in both themes', () => {
    // The contract caps the scale at a handful of steps on purpose: every
    // extra step is one more judgement call at every call site, and the
    // product has exactly three jobs for a shadow (resting panel, overlay,
    // modal). If this fails, the scale grew — re-read §5 before widening it.
    expect(Object.keys(shadows.light)).toEqual(['e1', 'e2', 'e3']);
    expect(Object.keys(shadows.dark)).toEqual(['e1', 'e2', 'e3']);
  });

  it('does not reuse the light scale in dark mode', () => {
    for (const step of ['e1', 'e2', 'e3'] as const) {
      expect(shadows.dark[step]).not.toBe(shadows.light[step]);
    }
  });

  /**
   * A shadow darkens whatever is behind it, and the dark ground is already
   * `#0f172a`, so the dark steps are pure black at roughly triple the alpha.
   * Tinting them with the light steps' slate (`15 23 42`) would make them
   * near-invisible — this pins the decision, not just the strings.
   */
  it('uses pure black at higher alpha for the dark steps', () => {
    for (const step of ['e1', 'e2', 'e3'] as const) {
      expect(shadows.light[step]).toContain('rgb(15 23 42 /');
      expect(shadows.dark[step]).toContain('rgb(0 0 0 /');
      const lightAlphas = alphasOf(shadows.light[step]);
      const darkAlphas = alphasOf(shadows.dark[step]);
      expect(darkAlphas).toHaveLength(lightAlphas.length);
      expect(lightAlphas).not.toHaveLength(0);
      for (const [index, lightAlpha] of lightAlphas.entries()) {
        expect(darkAlphas[index]).toBeGreaterThan(lightAlpha);
      }
    }
  });

  it('gives every step two layered shadows', () => {
    // One shadow reads as a hard edge; the contract's steps are all a tight
    // contact shadow plus a wider ambient one, which is what makes them look
    // like light rather than like a border.
    for (const theme of ['light', 'dark'] as const) {
      for (const step of ['e1', 'e2', 'e3'] as const) {
        expect(shadows[theme][step].split('), ')).toHaveLength(2);
      }
    }
  });

  it('increases in strength from e1 to e3', () => {
    for (const theme of ['light', 'dark'] as const) {
      const strongest = (['e1', 'e2', 'e3'] as const).map((step) =>
        Math.max(...alphasOf(shadows[theme][step])),
      );
      for (const [index, alpha] of strongest.slice(1).entries()) {
        expect(alpha).toBeGreaterThan(strongest[index] as number);
      }
    }
  });
});
