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
 * The drift check compares parsed `--name: value;` declarations by name and
 * scope, not by searching for a hex value anywhere in the file. An earlier
 * version did the latter (`css.includes(hex)`), which cannot catch a real
 * mistake: swapping `--color-status-paid-fg` and `--color-status-paid-bg`
 * leaves both hex strings present *somewhere* in the file, so a
 * presence-only check still reports OK while the badge is now unreadable.
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

const HEX_RE = /^#[0-9a-f]{6}$/i;

function srgbToLinear(c) {
  const n = c / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  if (!HEX_RE.test(hex)) {
    // NaN < min is false, so an unvalidated bad value would silently pass
    // every ratio check below it — fail loudly instead.
    throw new TypeError(`expected a #RRGGBB colour, got ${JSON.stringify(hex)}`);
  }
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

/**
 * Extract `--name: value;` declarations from one CSS block's body (the text
 * between its outermost `{` and matching `}`). Good enough for this file's
 * hand-authored shape — not a general CSS parser — but real enough to catch
 * a name/value mismatch, which string search cannot.
 */
function parseDeclarations(blockBody) {
  const vars = {};
  const withoutComments = blockBody.replace(/\/\*[\s\S]*?\*\//g, '');
  const declRe = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let match;
  while ((match = declRe.exec(withoutComments))) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}

function extractBlock(css, selectorRe) {
  const start = css.search(selectorRe);
  if (start === -1) return null;
  const braceStart = css.indexOf('{', start);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(braceStart + 1, i);
    }
  }
  return null;
}

/** `#RRGGBB` -> the `var(--color-scale-key)` string it should appear as, by
 * reverse-lookup against the raw scale. Semantic role tokens are authored as
 * references to the raw scale (see globals.css's own comment on why), so the
 * *correct* expected form is the reference, not the literal hex it resolves to. */
function buildReverseLookup(preset) {
  const byHex = {};
  for (const [key, hex] of Object.entries(preset.neutral))
    byHex[hex] = `var(--color-neutral-${key})`;
  for (const [key, hex] of Object.entries(preset.brand)) byHex[hex] = `var(--color-brand-${key})`;
  return byHex;
}

const errors = [];

const preset = await import(join(pkgRoot, 'tailwind.preset.ts'));

if (preset.CONTRAST_PAIRS.length === 0) {
  errors.push('CONTRAST_PAIRS is empty — no pairs are being verified.');
}

for (const { name, fg, bg, min } of preset.CONTRAST_PAIRS) {
  const actual = contrastRatio(fg, bg);
  if (actual < min) {
    errors.push(`${name}: ${fg} on ${bg} is ${actual.toFixed(2)}:1, needs >=${min}:1`);
  }
}

// --- Drift check: parsed name -> value, scoped to @theme (light/default) vs
// :root[data-theme="dark"], compared against what tailwind.preset.ts says
// each name should hold in that scope.
const cssPath = join(pkgRoot, 'src', 'styles', 'globals.css');
const css = readFileSync(cssPath, 'utf8');

const themeBody = extractBlock(css, /@theme\s*\{/);
const darkBody = extractBlock(css, /:root\[data-theme=["']dark["']\]\s*\{/);
if (themeBody === null) errors.push('globals.css: could not find an @theme block to check.');
if (darkBody === null)
  errors.push('globals.css: could not find a :root[data-theme="dark"] block to check.');

const lightVars = themeBody === null ? {} : parseDeclarations(themeBody);
const darkVars = darkBody === null ? {} : parseDeclarations(darkBody);

function expectVar(scopeVars, scopeName, varName, expectedValue) {
  const actual = scopeVars[varName];
  if (actual === undefined) {
    errors.push(`${scopeName}: expected ${varName}: ${expectedValue}; — declaration missing.`);
    return;
  }
  if (actual !== expectedValue) {
    errors.push(`${scopeName}: ${varName} is "${actual}", expected "${expectedValue}".`);
  }
}

// Raw scale: literal hex, always.
for (const [key, hex] of Object.entries(preset.neutral)) {
  expectVar(lightVars, '@theme', `--color-neutral-${key}`, hex);
}
for (const [key, hex] of Object.entries(preset.brand)) {
  expectVar(lightVars, '@theme', `--color-brand-${key}`, hex);
}
for (const [key, value] of Object.entries(preset.radius)) {
  expectVar(lightVars, '@theme', `--radius-${key}`, value);
}

// Status: fg/bg literal in light scope; fgDark literal in dark scope; bg is
// intentionally not overridden in dark scope (see globals.css's own note),
// so it is not asserted there.
for (const [statusKey, entry] of Object.entries(preset.status)) {
  expectVar(lightVars, '@theme', `--color-status-${statusKey}-fg`, entry.fg);
  expectVar(lightVars, '@theme', `--color-status-${statusKey}-bg`, entry.bg);
  expectVar(darkVars, ':root[data-theme="dark"]', `--color-status-${statusKey}-fg`, entry.fgDark);
}

// Typography (design contract §2). Typography is a token family like colour
// is, so it gets the same drift gate: the ramp lives in tailwind.preset.ts and
// globals.css only mirrors it. Unlike colour these are theme-invariant — a
// heading is 22px in dark mode too — so they are asserted in the @theme scope
// only, and the dark block is asserted NOT to redefine them.
expectVar(lightVars, '@theme', '--font-sans', preset.typography.fontSans);

const RAMP_SUBPROPS = [
  ['size', ''],
  ['lineHeight', '--line-height'],
  ['weight', '--font-weight'],
  ['tracking', '--letter-spacing'],
];
for (const [step, values] of Object.entries(preset.typography.ramp)) {
  for (const [tsKey, cssSuffix] of RAMP_SUBPROPS) {
    expectVar(lightVars, '@theme', `--text-${step}${cssSuffix}`, values[tsKey]);
  }
  for (const [, cssSuffix] of RAMP_SUBPROPS) {
    const name = `--text-${step}${cssSuffix}`;
    if (darkVars[name] !== undefined) {
      errors.push(
        `:root[data-theme="dark"]: ${name} is redefined ("${darkVars[name]}"). ` +
          'The type ramp is theme-invariant — remove it from the dark block.',
      );
    }
  }
}
if (darkVars['--font-sans'] !== undefined) {
  errors.push(':root[data-theme="dark"]: --font-sans is redefined; the family is theme-invariant.');
}

// Semantic roles: authored as `var(--color-scale-key)` references where the
// value matches a raw-scale entry, or a literal hex where it does not (e.g.
// dark.surface has no raw-scale equivalent).
const reverseLookup = buildReverseLookup(preset);
const roleVarNames = {
  bg: '--color-bg',
  surface: '--color-surface',
  textPrimary: '--color-text-primary',
  textSecondary: '--color-text-secondary',
  border: '--color-border-functional',
  brand: '--color-brand',
};
for (const [roleKey, cssVarName] of Object.entries(roleVarNames)) {
  const lightExpected = reverseLookup[preset.light[roleKey]] ?? preset.light[roleKey];
  expectVar(lightVars, '@theme', cssVarName, lightExpected);

  const darkExpected = reverseLookup[preset.dark[roleKey]] ?? preset.dark[roleKey];
  expectVar(darkVars, ':root[data-theme="dark"]', cssVarName, darkExpected);
}

/**
 * The brand hex also appears OUTSIDE `ui/`, in files this script previously
 * never opened: the PWA manifest constant, the `<meta name="theme-color">`
 * tag, and the favicon artwork. A `.webmanifest` is consumed by the OS and an
 * `index.html` meta tag is read before any CSS loads, so neither can resolve a
 * custom property — the hex has to be repeated as a literal in both.
 *
 * Repeated literals drift. During [8.13.3]'s re-grade the favicon and the
 * three PWA PNGs were missed on the first pass precisely because nothing
 * checked them, while a comment in manifest.ts claimed this script already
 * did. It didn't: everything above only ever reads globals.css and
 * tailwind.preset.ts. So check them here, where the brand value is known.
 *
 * The PNG icons are renders of favicon.svg and cannot be verified by reading
 * text; see #358.
 */
const repoRoot = resolve(pkgRoot, '..');
const brandHex = preset.brand[600].toLowerCase();
const brandHexSites = [
  ['client-admin/src/pwa/manifest.ts', 'PWA manifest theme_color constant'],
  ['client-admin/index.html', '<meta name="theme-color">'],
  ['client-admin/public/favicon.svg', 'favicon artwork'],
];
for (const [relPath, description] of brandHexSites) {
  let contents;
  try {
    contents = readFileSync(join(repoRoot, relPath), 'utf8');
  } catch {
    errors.push(`${relPath} could not be read — the ${description} is unguarded`);
    continue;
  }
  if (!contents.toLowerCase().includes(brandHex)) {
    errors.push(
      `${relPath} does not contain the brand-600 hex ${brandHex} — ` +
        `the ${description} has drifted from tailwind.preset.ts`,
    );
  }
}

if (errors.length > 0) {
  console.error('check-contrast: FAILED\n');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `check-contrast: OK — ${preset.CONTRAST_PAIRS.length} pairs meet WCAG 2.2, ` +
    `${Object.keys(preset.typography.ramp).length} type steps mirrored, ` +
    `CSS mirror matches tailwind.preset.ts by name and scope, ` +
    `and ${brandHexSites.length} out-of-ui brand-hex sites match brand-600.`,
);
