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
  contents.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(RAW_PALETTE_RE)) {
      // Trim the single leading boundary character the regex had to consume.
      const utility = match[0].replace(/^[^a-z]/, '');
      errors.push(
        `${relative(repoRoot, file)}:${index + 1} uses the raw Tailwind palette class ` +
          `\`${utility}\` — that colour comes from Tailwind's defaults, not from the ` +
          'design tokens, so it will not follow the palette. Use a token-backed class ' +
          '(bg-background, text-foreground, border-border-subtle, text-neutral-600, …).',
      );
    }
    for (const match of line.matchAll(ARBITRARY_COLOUR_RE)) {
      const utility = match[0].replace(/^[^a-z]/, '');
      errors.push(
        `${relative(repoRoot, file)}:${index + 1} hard-codes a literal colour in ` +
          `\`${utility}…\` — an arbitrary value bypasses the token system entirely, ` +
          'so the palette cannot reach it at all. Use a token-backed class instead, ' +
          'or add the colour to tailwind.preset.ts if it is genuinely a new token.',
      );
    }
  });
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

if (errors.length > 0) {
  console.error('check-raw-palette: FAILED\n');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `check-raw-palette: OK — ${scanned} files in ui/src and ${apps.length} client app(s) ` +
    `(${apps.join(', ')}) carry no raw ${DEFAULT_HUES.length}-hue Tailwind palette ` +
    'classes and no hard-coded literal colours.',
);
