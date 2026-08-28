import { describe, expect, it } from 'vitest';

import { CONTRAST_PAIRS, dark, light, neutral } from '../../tailwind.preset';

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
