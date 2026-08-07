/**
 * Registers `toHaveNoViolations()` globally — imported once from
 * `ui/src/test/setup.ts`'s `setupFiles`, so no component test file needs
 * its own `expect.extend` call.
 *
 * Formats violations itself rather than using `vitest-axe`'s own
 * `toHaveNoViolations`/`extend-expect` entry points: `vitest-axe@0.1.0`'s
 * `matchers` subpath ships a `.d.ts` that re-exports everything with
 * `export type *`, so its `toHaveNoViolations` function can't be imported
 * as a value under this project's TS settings, and its `extend-expect`
 * entry's actual JS file is empty — both genuinely broken in the published
 * package, not a local misconfiguration. `axe-core` (the thing doing the
 * real scanning) is unaffected, so this only depends on that plus
 * `vitest-axe`'s thin `axe()` runner wrapper.
 */
import type AxeCore from 'axe-core';
import { expect } from 'vitest';
import { axe } from 'vitest-axe';

declare module 'vitest' {
  // Must match @vitest/expect's own `interface Matchers<T = any>` exactly —
  // TS requires identical type parameters across merged declarations.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> {
    toHaveNoViolations: () => Promise<T>;
  }
}

// jsdom has no real layout/paint engine — `getComputedStyle` on
// pseudo-elements and `HTMLCanvasElement#getContext` are both
// unimplemented, so axe-core's color-contrast check can't do anything
// useful here and only spams stderr with "Not implemented" errors from
// jsdom itself. Contrast needs an actual renderer (a real browser, or a
// visual-regression tool) to mean anything; the other ~90 rules this
// still runs cover the accessibility issues that show up in markup/ARIA
// structure regardless of how it's painted.
//
// `region` ("all page content should be contained by landmarks") is a
// page-layout concern — it fires the moment a test scans `baseElement`
// (real `document.body`, needed to reach Radix's portaled dialog/menu/
// tooltip content) because a component test's `document.body` was never
// going to have a `<main>`/`<nav>` around it. A real page assembled from
// these components does get that structure from its shell, just not from
// any single component in isolation, so this rule can't be satisfied here
// and isn't what these tests are checking for.
const JSDOM_AXE_OPTIONS: AxeCore.RunOptions = {
  rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
};

expect.extend({
  async toHaveNoViolations(received: Element) {
    const results = await axe(received, JSDOM_AXE_OPTIONS);
    const pass = results.violations.length === 0;
    return {
      pass,
      message: () => (pass ? '' : formatViolations(results.violations)),
    };
  },
});

function formatViolations(violations: AxeCore.Result[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `  ${node.target.join(', ')}\n    ${node.html}\n    ${node.failureSummary}`)
        .join('\n');
      return `${violation.id} (${violation.impact}): ${violation.help}\n${nodes}\n${violation.helpUrl}`;
    })
    .join('\n\n');
}
