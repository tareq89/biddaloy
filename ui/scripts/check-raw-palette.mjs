#!/usr/bin/env node
/**
 * Fail the build when a raw Tailwind hue-scale utility (`bg-zinc-900`,
 * `text-blue-500`, `dark:border-slate-700`, …) appears in shipped source.
 *
 * Why this needs to be a gate rather than a review habit: those classes
 * resolve against Tailwind's *default* palette, which the design tokens do
 * not control. A component styled with `bg-white text-zinc-900` looks fine
 * on the day it is written and then silently ignores every palette change
 * the token system makes — which is exactly how `client-admin/index.html`'s
 * `<body>` ended up painting a hard-coded white ground with an OS-keyed
 * `dark:` half-theme on top of it ([8.13.7]). Design contract §8.
 *
 * Scope is deliberately narrow: **default hue scales only.** The preset
 * defines its own `neutral-*`, `brand-*` and semantic role colours, so
 * `text-neutral-600` and `bg-brand-50` are token-backed and allowed. Fixed
 * physical values (`bg-black/10`, `bg-white/50`) are also allowed — the
 * dialog scrim in `ui/src/primitives/dialog.tsx` is a real, intentional use
 * of one and must keep working. What is banned is the family of names that
 * *look* like tokens but come from Tailwind's defaults.
 *
 * Run via `check:raw-palette` in package.json; wired into CI beside
 * `check:contrast`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(pkgRoot, '..');

/** Tailwind's built-in hue scales. `neutral` and `brand` are absent on
 * purpose: the preset defines those names itself, so they are token-backed. */
const DEFAULT_HUES = [
  'slate',
  'gray',
  'zinc',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
];

const COLOUR_UTILITIES = [
  'bg',
  'text',
  'border',
  'ring',
  'outline',
  'fill',
  'stroke',
  'from',
  'via',
  'to',
  'divide',
  'accent',
  'caret',
  'decoration',
  'shadow',
  'placeholder',
];

/**
 * Several of the utilities above take a side/axis/offset segment between the
 * utility root and the colour, and an earlier version of this file matched
 * only the bare roots. That left the directional spellings of the exact bug
 * this gate exists to prevent sliding through green: the per-edge border
 * utilities, the two divide axes, and the ring/outline offset colours all
 * name a default hue in a position the old pattern never looked at.
 *
 * `se`/`ss`/`ee`/`es` are Tailwind's logical-property sides, so the check
 * follows a right-to-left layout as well as a left-to-right one.
 */
const UTILITY_SEGMENTS = ['t', 'b', 'l', 'r', 'x', 'y', 's', 'e', 'ss', 'se', 'es', 'ee', 'offset'];

/**
 * The leading `(?:^|[^a-z-])` stops compound names that merely *end* in a hue
 * word from matching on their tail, and the optional `(?:[a-z-]+:)*` lets the
 * check see through variant prefixes (`hover:`, `md:`, and the theme one).
 */
const UTILITY_PREFIX = `(?:^|[^a-z-])(?:[a-z-]+:)*(?:${COLOUR_UTILITIES.join('|')})(?:-(?:${UTILITY_SEGMENTS.join('|')}))?-`;

const RAW_PALETTE_RE = new RegExp(`${UTILITY_PREFIX}(?:${DEFAULT_HUES.join('|')})-\\d+`, 'g');

/**
 * A literal colour in square brackets is the most direct way there is to opt
 * out of the token system — it does not even pretend to be a token, it just
 * hard-codes the value — so it is banned in the same places for the same
 * reason.
 *
 * Deliberately narrow: only values that are unambiguously colours (a hex
 * literal, or one of the four CSS colour functions) are matched. Arbitrary
 * values are legitimate for non-colour things a colour-adjacent utility can
 * take — a gradient stop position, an offset width, a `currentColor`
 * reference, a CSS variable the token layer itself defines — and banning
 * those would push authors back onto the raw palette this gate is trying to
 * remove.
 */
const ARBITRARY_COLOUR_RE = new RegExp(
  `${UTILITY_PREFIX}\\[(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab)\\()`,
  'g',
);

/**
 * Elevation is a token role, not a size. Tailwind's own shadow scale
 * (`shadow-sm`, `shadow-md`, `shadow-lg`, …) bakes a fixed rgba value into the
 * compiled rule, so a shadow written that way cannot follow the theme: the
 * dark block can re-point `--shadow-e2` at a different value, but nothing can
 * reach a literal `0 4px 6px -1px rgb(0 0 0 / 0.1)` that Tailwind already
 * inlined. [8.13.9] routed every surface shadow through `--shadow-e1/e2/e3`
 * (§5 of docs/architecture/09-design-direction.md); this gate keeps them there.
 *
 * `shadow-none` stays legal — it removes elevation rather than inventing one —
 * and so do the `shadow-e*` tokens themselves. Variant prefixes are seen
 * through, because `focus-visible:shadow-lg` is exactly as unthemed as a bare
 * `shadow-lg`. Colour modifiers (`shadow-brand-600`) are already covered by the
 * raw-palette check above, so this one only looks at the size scale.
 *
 * **`drop-shadow-*` is deliberately NOT banned here.** An earlier revision
 * folded it in via a `(?:drop-)?` prefix, which made the gate demand a
 * replacement that does not exist: there is no `--drop-shadow-e*` token, and
 * `filter: drop-shadow()` cannot consume a `box-shadow` value, so
 * `drop-shadow-md` had no legal spelling to move to. A gate with no green path
 * is a gate people disable. If the design system ever grows a themed
 * drop-shadow scale, add the tokens first and then add `drop-` back.
 */
const RAW_SHADOW_RE =
  /(?:^|[^a-z-])(?:[a-z-]+:)*shadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner)(?![a-z0-9-])/g;

/**
 * The named scale is only half of the escape hatch. `shadow-[0_1px_2px_rgb(0_0_0/0.1)]`
 * inlines exactly the same untouchable literal, and it slipped through both
 * gates: it is not a size keyword, so `RAW_SHADOW_RE` never saw it, and
 * `ARBITRARY_COLOUR_RE` requires the `[` to be followed *immediately* by a hex
 * or colour function, which an offset-first box-shadow value never is. That is
 * precisely the "cannot follow the theme" failure this check exists to catch,
 * written in the most direct way available.
 *
 * A bracket holding nothing but a `var()` reference is allowed: that IS the
 * token system, just spelled long-hand. Pure colour literals are excluded from
 * the lookahead so `shadow-[#000]` reports once, through the arbitrary-colour
 * rule, rather than twice.
 */
const ARBITRARY_SHADOW_RE = new RegExp(
  `(?:^|[^a-z-])(?:[a-z-]+:)*shadow-\\[(?!var\\(|#|rgba?\\(|hsla?\\(|oklch\\(|oklab\\()`,
  'g',
);

/**
 * Strip comments before scanning.
 *
 * The scan is a raw line match, so it could not tell a class attribute from
 * prose *about* a class. That already cost real work: the explanatory comment
 * in `ui/src/foundations/elevation.stories.tsx` had to be reworded around the
 * gate rather than saying what it meant, and any future comment in `ui/src`
 * that names `shadow-md` — including the one you are reading, in a file this
 * check happens not to scan — would fail the build with an error pointing at
 * documentation. `src/styles/density.spec.ts` already learned to strip
 * comments before asserting on CSS; the same discipline applies here.
 *
 * Line numbers are preserved: a block comment is replaced by the newlines it
 * spanned, so reported positions still point at the real line.
 *
 * `//` is only treated as a comment when it opens the line's content. That is
 * deliberately conservative — a regex that stripped from any `//` to the end
 * of the line would eat the tail of any string containing `https://`, which is
 * a far more common way to hide a violation than a trailing comment is.
 */
export function stripComments(contents) {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, (block) => '\n'.repeat((block.match(/\n/g) ?? []).length))
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'storybook-static', 'coverage', '.turbo']);

function walk(dir, matches, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    // A dangling symlink, or a file deleted by a concurrent build between the
    // `readdirSync` above and this line, makes `statSync` throw. Unguarded,
    // that ends the CI step in a raw Node stack trace instead of the
    // lint-style report the rest of this script produces — and it takes the
    // remaining, still-scannable files down with it. Skipping the entry is
    // safe: something we cannot stat is something we cannot read either.
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) walk(full, matches, files);
    else if (matches(entry)) files.push(full);
  }
  return files;
}

const isSource = (name) => /\.(?:ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name);

/**
 * Discover the SPAs instead of naming them.
 *
 * The root package.json declares its app workspaces as a `client-*` glob, so
 * hard-coding one app name here meant coverage stopped following the
 * workspace definition: a second SPA added under the same glob would get zero
 * scanning, and the "nothing was scanned" guard below could not catch it
 * because the one hard-coded app kept the target list non-empty. The gate
 * would then print OK for an app it had never opened.
 */
function clientApps() {
  let entries;
  try {
    entries = readdirSync(repoRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return (
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('client-'))
      .map((entry) => entry.name)
      // A `package.json` is what makes a directory an actual workspace member.
      // The repo can carry leftover `client-*` directories holding nothing but
      // build artefacts (a stray `tsconfig.tsbuildinfo`, say); counting those
      // as apps would inflate the summary line into claiming coverage of
      // something that is not shipped source.
      .filter((name) => existsSync(join(repoRoot, name, 'package.json')))
      .sort()
  );
}

/**
 * Scan one file's contents and return the human-readable violations.
 *
 * Exported so `check-raw-palette.spec.mjs` can assert the *negative* cases —
 * that a legal spelling stays green — as well as the positive ones. A gate
 * that only ever gets tested by "does the repo pass today" cannot tell the
 * difference between a rule that works and a rule that matches nothing.
 */
export function scanFile(displayPath, rawContents) {
  const errors = [];
  const contents = stripComments(rawContents);

  contents.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(RAW_PALETTE_RE)) {
      // Trim the single leading boundary character the regex had to consume.
      const utility = match[0].replace(/^[^a-z]/, '');
      errors.push(
        `${displayPath}:${index + 1} uses the raw Tailwind palette class ` +
          `\`${utility}\` — that colour comes from Tailwind's defaults, not from the ` +
          'design tokens, so it will not follow the palette. Use a token-backed class ' +
          '(bg-background, text-foreground, border-border-subtle, text-neutral-600, …).',
      );
    }
    for (const match of line.matchAll(RAW_SHADOW_RE)) {
      const utility = match[0].replace(/^[^a-z]/, '');
      errors.push(
        `${displayPath}:${index + 1} uses the raw Tailwind shadow scale ` +
          `\`${utility}\` — Tailwind inlines that shadow's literal rgba value, so it ` +
          'cannot follow the theme. Use an elevation token instead (shadow-e1 for a ' +
          'resting card, shadow-e2 for a popover/menu, shadow-e3 for a dialog), or ' +
          'shadow-none to remove elevation.',
      );
    }
    for (const match of line.matchAll(ARBITRARY_SHADOW_RE)) {
      const utility = match[0].replace(/^[^a-z]/, '');
      errors.push(
        `${displayPath}:${index + 1} hard-codes a literal shadow in ` +
          `\`${utility}…\` — an inlined box-shadow value is exactly as unthemed as ` +
          'shadow-md: the dark block cannot reach it. Use an elevation token ' +
          '(shadow-e1/e2/e3), or shadow-none.',
      );
    }
    for (const match of line.matchAll(ARBITRARY_COLOUR_RE)) {
      const utility = match[0].replace(/^[^a-z]/, '');
      errors.push(
        `${displayPath}:${index + 1} hard-codes a literal colour in ` +
          `\`${utility}…\` — an arbitrary value bypasses the token system entirely, ` +
          'so the palette cannot reach it at all. Use a token-backed class instead, ' +
          'or add the colour to tailwind.preset.ts if it is genuinely a new token.',
      );
    }
  });

  return errors;
}

export function runCheck() {
  const apps = clientApps();

  // Stories are included on purpose: a story is rendered UI, and the whole
  // point of the design system is that it obeys the same tokens everywhere.
  const targets = [
    ...walk(join(pkgRoot, 'src'), isSource),
    ...apps.flatMap((app) => [
      ...walk(join(repoRoot, app, 'src'), isSource),
      // Not every workspace member is guaranteed to have one; a missing entry
      // point is not this gate's business to report.
      ...(existsSync(join(repoRoot, app, 'index.html')) ? [join(repoRoot, app, 'index.html')] : []),
    ]),
  ];

  const errors = [];
  let scanned = 0;

  for (const file of targets) {
    let contents;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      errors.push(`${relative(repoRoot, file)} could not be read`);
      continue;
    }
    scanned += 1;
    errors.push(...scanFile(relative(repoRoot, file), contents));
  }

  if (apps.length === 0) {
    errors.push(
      'no client-* app directories were found next to ui/ — the workspace glob has ' +
        'moved, so no application source was scanned by this check',
    );
  }

  if (targets.length === 0) {
    errors.push('no files were scanned — the target globs are wrong, so this check proves nothing');
  }

  return { errors, scanned, apps };
}

function main() {
  const { errors, scanned, apps } = runCheck();

  if (errors.length > 0) {
    console.error('check-raw-palette: FAILED\n');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log(
    `check-raw-palette: OK — ${scanned} files in ui/src and ${apps.length} client app(s) ` +
      `(${apps.join(', ')}) carry no raw ${DEFAULT_HUES.length}-hue Tailwind palette ` +
      'classes, no hard-coded literal colours and no raw Tailwind shadow-scale classes.',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
