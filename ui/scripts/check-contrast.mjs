#!/usr/bin/env node
/**
 * Verify every documented token pair against WCAG 2.2 contrast minimums, and
 * verify the CSS mirror in globals.css has not drifted from the TypeScript
 * source of truth.
 *
 * Two failure modes, both silent until someone notices a component is hard
 * to read:
 *
 *  1. A colour value that does not actually clear its required ratio. Values
 *     in tailwind.preset.ts are asserted here rather than trusted, because a
 *     hex code "looking about right" is not evidence.
 *
 *  2. globals.css drifting from tailwind.preset.ts. The CSS `@theme` block
 *     is a hand-maintained mirror of the TS token values (Tailwind v4 has no
 *     mechanism to generate CSS custom properties from a TS file), so
 *     nothing stops the two from disagreeing except this check.
 *
 * Run via `node --experimental-strip-types` — see check:contrast in
 * package.json. That flag imports tailwind.preset.ts's real exported
 * values directly rather than re-parsing them by hand; CONTRAST_PAIRS
 * references other exported constants (e.g. `light.textPrimary`), not
 * repeated literals, so a text-regex parse cannot reconstruct it correctly.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function srgbToLinear(c) {
  const n = c / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(hexA, hexB) {
  const [l1, l2] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

const errors = [];

const preset = await import(join(pkgRoot, 'tailwind.preset.ts'));

if (preset.CONTRAST_PAIRS.length === 0) {
  errors.push('CONTRAST_PAIRS is empty — no pairs are being verified.');
}

for (const { name, fg, bg, min } of preset.CONTRAST_PAIRS) {
  const actual = contrastRatio(fg, bg);
  if (actual < min) {
    errors.push(
      `${name}: ${fg} on ${bg} is ${actual.toFixed(2)}:1, needs >=${min}:1`,
    );
  }
}

// --- Drift check: every hex value in tailwind.preset.ts's flat scales must
// appear somewhere in globals.css's @theme block, or the two have diverged.
const cssPath = join(pkgRoot, 'src', 'styles', 'globals.css');
const css = readFileSync(cssPath, 'utf8');

const flatSources = {
  neutral: preset.neutral,
  brand: preset.brand,
};
for (const [scaleName, scale] of Object.entries(flatSources)) {
  for (const [key, hex] of Object.entries(scale)) {
    if (!css.includes(hex)) {
      errors.push(
        `${scaleName}[${key}] = ${hex} is in tailwind.preset.ts but not found anywhere in ` +
          'globals.css — the CSS mirror has drifted.',
      );
    }
  }
}
for (const [statusKey, entry] of Object.entries(preset.status)) {
  for (const field of ['fg', 'bg']) {
    if (!css.includes(entry[field])) {
      errors.push(
        `status.${statusKey}.${field} = ${entry[field]} is in tailwind.preset.ts but not ` +
          'found in globals.css — the CSS mirror has drifted.',
      );
    }
  }
}

if (errors.length > 0) {
  console.error('check-contrast: FAILED\n');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `check-contrast: OK — ${preset.CONTRAST_PAIRS.length} pairs meet WCAG 2.2, ` +
    'CSS mirror matches tailwind.preset.ts.',
);
