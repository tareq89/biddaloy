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
import { createRequire } from 'node:module';
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
// The plain `:root` block holding the light elevation values. `@theme`
// cannot hold them itself — see the long note in globals.css.
//
// Matched by its CONTENTS, not by being the first plain `:root` in the file.
// Binding to the first one would break the moment another plain `:root` is
// added above it (a `color-scheme` declaration is the obvious candidate when
// #353 ships the theme toggle): the gate would parse that block, find no
// `--elevation-*`, and fail while pointing at entirely the wrong thing.
const rootBody = extractBlock(css, /:root\s*\{(?=[^}]*--elevation-)/);
// Likewise the plain `:root` holding the motion family — a second contents-
// matched block, for the same reason and with the same protection against
// binding to whichever plain `:root` happens to come first in the file.
const motionRootBody = extractBlock(css, /:root\s*\{(?=[^}]*--motion-)/);
if (themeBody === null) errors.push('globals.css: could not find an @theme block to check.');
if (darkBody === null)
  errors.push('globals.css: could not find a :root[data-theme="dark"] block to check.');
if (rootBody === null) errors.push('globals.css: could not find a plain :root block to check.');
if (motionRootBody === null)
  errors.push('globals.css: could not find a plain :root block declaring --motion-* to check.');

const lightVars = themeBody === null ? {} : parseDeclarations(themeBody);
const darkVars = darkBody === null ? {} : parseDeclarations(darkBody);
const rootVars = rootBody === null ? {} : parseDeclarations(rootBody);
const motionVars = motionRootBody === null ? {} : parseDeclarations(motionRootBody);

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
  // Subtle border is registered here for drift/lockstep only. It has no
  // CONTRAST_PAIRS row on purpose (decorative, exempt from SC 1.4.11) —
  // this gate is what stops the preset and globals.css disagreeing about it.
  borderSubtle: '--color-border-subtle',
  brand: '--color-brand',
};
for (const [roleKey, cssVarName] of Object.entries(roleVarNames)) {
  const lightExpected = reverseLookup[preset.light[roleKey]] ?? preset.light[roleKey];
  expectVar(lightVars, '@theme', cssVarName, lightExpected);

  const darkExpected = reverseLookup[preset.dark[roleKey]] ?? preset.dark[roleKey];
  expectVar(darkVars, ':root[data-theme="dark"]', cssVarName, darkExpected);
}

/**
 * Elevation (design contract §5). Shadows are not colours, so there is no
 * ratio to check — but they are a mirrored token family, so they get the same
 * drift gate everything else here gets, across three scopes:
 *
 *  1. `@theme` must point `--shadow-eN` at `var(--elevation-eN)` and not at a
 *     literal. This is the assertion that actually matters: Tailwind v4
 *     inlines a `--shadow-*` theme value into the utility at build time, so
 *     writing the numbers here instead would compile a shadow the dark block
 *     cannot override — dead CSS that silently does nothing. Someone
 *     "simplifying" the indirection away breaks dark mode and sees no error
 *     anywhere else; this line is that error.
 *  2. The plain `:root` block holds the light values.
 *  3. `:root[data-theme="dark"]` holds the dark ones.
 *
 * Values are compared as exact strings, so `0.40` may not become `0.4`.
 */
const lightSteps = Object.keys(preset.shadows.light);
const darkSteps = Object.keys(preset.shadows.dark);
if (lightSteps.join(',') !== darkSteps.join(',')) {
  errors.push(
    `tailwind.preset.ts: shadows.light has steps [${lightSteps}] but shadows.dark has ` +
      `[${darkSteps}] — every step needs both halves or one theme silently loses it.`,
  );
}
for (const step of lightSteps) {
  expectVar(lightVars, '@theme', `--shadow-${step}`, `var(--elevation-${step})`);
  expectVar(rootVars, ':root', `--elevation-${step}`, preset.shadows.light[step]);
  expectVar(darkVars, ':root[data-theme="dark"]', `--elevation-${step}`, preset.shadows.dark[step]);

  // The other route to the same dead-CSS bug. Asserting `@theme` holds the
  // indirection is only half the guard: someone debugging dark shadows will
  // reach for `--shadow-e2` in the dark block, and because the utility reads
  // `var(--elevation-e2)`, that declaration does nothing at all. Without this
  // check the gate would print OK over exactly the silent failure it exists
  // to catch.
  if (darkVars[`--shadow-${step}`] !== undefined) {
    errors.push(
      `globals.css: :root[data-theme="dark"] declares --shadow-${step}, which has no effect — ` +
        `the .shadow-${step} utility reads var(--elevation-${step}). Override --elevation-${step} instead.`,
    );
  }
}

/**
 * Motion (design contract §7). Five values, mirrored in a plain `:root` —
 * motion is theme-invariant, so unlike colour there is no dark half. The
 * dark block is asserted NOT to redefine any of them: a stray override there
 * is exactly the silent drift §1 means by "same value in both scopes".
 *
 * Values are literals, not hexes, so no ratio applies — this is a pure
 * mirror check, the same one typography gets.
 *
 * Scope matters here as much as value. `@theme` is asserted NOT to hold
 * them, because Tailwind v4 tree-shakes `@theme`: a variable no scanned
 * utility reads is dropped from the build entirely, so an `@theme` motion
 * family would compile to nothing and every `var(--motion-duration-base)`
 * outside a scanned class would silently resolve to an invalid value. The
 * compiled-output assertion further down is the end-to-end proof; this is
 * the one that names the cause.
 */
const motionVarNames = {
  durationFast: '--motion-duration-fast',
  durationBase: '--motion-duration-base',
  durationSlow: '--motion-duration-slow',
  easeStandard: '--motion-ease-standard',
  easeExit: '--motion-ease-exit',
};
for (const [key, cssVarName] of Object.entries(motionVarNames)) {
  expectVar(motionVars, ':root', cssVarName, preset.motion[key]);
  if (lightVars[cssVarName] !== undefined) {
    errors.push(
      `@theme: ${cssVarName} is declared here, where Tailwind drops it unless a scanned ` +
        'utility reads it. Declare motion tokens in the plain :root block instead.',
    );
  }
  if (darkVars[cssVarName] !== undefined) {
    errors.push(
      `:root[data-theme="dark"]: ${cssVarName} is redefined ("${darkVars[cssVarName]}"). ` +
        'Motion is theme-invariant — remove it from the dark block.',
    );
  }
}

/**
 * The global `prefers-reduced-motion: reduce` rule (design contract §7).
 *
 * Nothing else in the repo would notice if this block were deleted: no unit
 * test can assert a media query it never matches, and the e2e spec that does
 * assert it (`e2e/reduced-motion.spec.ts`) only runs where browsers do. A
 * deletion would be invisible until a user with the OS preference set met a
 * spinner. So the presence and contents of the rule are checked here, in the
 * gate that already blocks CI on every other token-drift failure.
 *
 * Contents, not just presence: a rule that survives with
 * `animation-iteration-count` dropped still passes a grep for `@media` while
 * having stopped doing the one thing that tames an infinite spinner.
 */
//
// Matched by its CONTENTS (the universal selector's `animation-duration`),
// not by being the first `prefers-reduced-motion` query in the file — same
// reasoning as the plain `:root` blocks above. A per-component
// `@media (prefers-reduced-motion: reduce)` added earlier in the file would
// otherwise capture this check, which would then report the global rule
// "missing" while pointing at the wrong block. `[^}]*` reaches only as far
// as the first `}`, which is the end of the universal-selector rule nested
// directly inside the query — exactly the block being described.
const reducedMotionBody = extractBlock(
  css,
  /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(?=[^}]*animation-duration)/,
);
if (reducedMotionBody === null) {
  errors.push(
    'globals.css: the global @media (prefers-reduced-motion: reduce) rule is missing — ' +
      'reduced motion is a global rule by design (contract §7), not a per-component variant.',
  );
} else {
  const ruleText = reducedMotionBody.replace(/\/\*[\s\S]*?\*\//g, '');
  const REQUIRED_REDUCED_MOTION = [
    ['universal selector', /\*\s*,[\s\S]*?\*::before[\s\S]*?\*::after/],
    ['animation-duration: 0.01ms !important', /animation-duration:\s*0\.01ms\s*!important\s*;/],
    ['animation-iteration-count: 1 !important', /animation-iteration-count:\s*1\s*!important\s*;/],
    ['transition-duration: 0.01ms !important', /transition-duration:\s*0\.01ms\s*!important\s*;/],
    ['scroll-behavior: auto !important', /scroll-behavior:\s*auto\s*!important\s*;/],
  ];
  for (const [description, re] of REQUIRED_REDUCED_MOTION) {
    if (!re.test(ruleText)) {
      errors.push(
        `globals.css: the reduced-motion rule no longer declares ${description}. ` +
          'See the contract §7 block it is copied from.',
      );
    }
  }
}

/**
 * End-to-end proof: the tokens above survive COMPILATION, not just review.
 *
 * Everything before this point reads `globals.css` as source text, which is
 * one step short of the truth. Tailwind v4 tree-shakes `@theme`: a custom
 * property declared there is emitted only if the class scanner sees a
 * utility that reads it. So a token family can be present, correct and
 * perfectly mirrored in source while shipping ZERO BYTES to the browser —
 * and the failure is silent, because `var(--missing)` in a hand-written rule
 * or an inline style resolves to an invalid value and computes to `0s`
 * rather than raising anything.
 *
 * That is not hypothetical: it is the exact shape of the shadow-inlining bug
 * #346 fixed, and the motion family shipped in this state on first pass. So
 * compile the real stylesheet with the pinned Tailwind and assert the values
 * are actually in the output.
 *
 * `build([])` — no scanned candidates — is the strictest case on purpose. It
 * models "no component uses these yet", which is precisely when the
 * tree-shaking trap bites, and it means the assertion does not quietly start
 * passing for the wrong reason once some unrelated utility happens to pull a
 * variable in.
 */
const { compile } = await import('tailwindcss');
const require = createRequire(import.meta.url);

let compiledCss = null;
try {
  const compiler = await compile(css, {
    base: dirname(cssPath),
    // Tailwind hands back `@import` specifiers to be resolved by the host.
    // `globals.css` imports the bare package (`tailwindcss`), whose own
    // index.css then imports its siblings relatively.
    loadStylesheet: async (id, base) => {
      const path = id.startsWith('.')
        ? resolve(base, id)
        : require.resolve(id.endsWith('.css') ? id : `${id}/index.css`);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  compiledCss = compiler.build([]);
} catch (error) {
  errors.push(`globals.css could not be compiled with tailwindcss: ${error.message}`);
}

if (compiledCss !== null) {
  // Exact `--name: value` pairs, so a token that survives compilation with a
  // mangled value fails just as loudly as one that vanishes.
  const compiledExpectations = [
    ...Object.entries(motionVarNames).map(([key, cssVarName]) => [
      cssVarName,
      preset.motion[key],
      'motion token (contract §7)',
    ]),
    ...lightSteps.map((step) => [
      `--elevation-${step}`,
      preset.shadows.light[step],
      'light elevation step (contract §5)',
    ]),
    ...darkSteps.map((step) => [
      `--elevation-${step}`,
      preset.shadows.dark[step],
      'dark elevation step (contract §5)',
    ]),
  ];
  for (const [cssVarName, expectedValue, description] of compiledExpectations) {
    if (!compiledCss.includes(`${cssVarName}: ${expectedValue}`)) {
      errors.push(
        `compiled CSS: ${cssVarName}: ${expectedValue} is not in the build output — the ` +
          `${description} ships nothing, so every var() reading it computes to an invalid ` +
          'value. Declare it in a plain :root, not @theme (Tailwind drops unused @theme vars).',
      );
    }
  }

  if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(compiledCss)) {
    errors.push(
      'compiled CSS: the global @media (prefers-reduced-motion: reduce) rule is not in the ' +
        'build output, so no user with the OS preference set is served it.',
    );
  }
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
    `${lightSteps.length} elevation steps mirrored in light and dark, ` +
    `${Object.keys(motionVarNames).length} motion tokens mirrored under a live reduced-motion rule, ` +
    `all of them plus every elevation step verified present in the compiled CSS, ` +
    `CSS mirror matches tailwind.preset.ts by name and scope, ` +
    `and ${brandHexSites.length} out-of-ui brand-hex sites match brand-600.`,
);
