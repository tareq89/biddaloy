#!/usr/bin/env node
/**
 * Fail the build if any of the old focus-ring vocabularies this ticket
 * ([8.14.14]) deleted reappears in shipped source.
 *
 * Why this needs a gate rather than a review habit: three different
 * focus-ring spellings coexisted in this codebase before this ticket —
 * `border-ring`/`ring-3`/`ring-ring/50` (brand-on-brand at 50% alpha,
 * nearly invisible on a brand-filled control), a `ring-[3px]` +
 * `outline-1 outline-ring` double-up on tabs, and a bare
 * `outline`/`outline-2`/`outline-ring` in two client-admin call sites.
 * Nothing stopped a fourth from being pasted in from an old shadcn
 * snippet or a search result — a lint rule that only checks "does the
 * repo pass today" would not catch that on the next PR. The canonical
 * string every focusable control should carry instead (design contract
 * — its source of truth is the class string on `ui/src/primitives/
 * button.tsx`, pending the focus section of
 * `docs/architecture/09-design-direction.md`, which another lane of the
 * 8.14 run owns) is copied verbatim
 * from `ui/src/primitives/button.tsx`:
 *
 *   outline-none focus-visible:ring-2 focus-visible:ring-ring
 *   focus-visible:ring-offset-2 focus-visible:ring-offset-background
 *
 * Three deliberate deviations from that string are allowed and are *not*
 * flagged by this gate:
 *
 *   1. `ui/src/components/skip-link.tsx` — no offset, because it paints
 *      over page content and a ground-coloured gutter would read as a
 *      rendering glitch.
 *   2. `ui/src/components/date-picker.tsx`'s day cell —
 *      `ring-offset-popover` + `focus-visible:relative focus-visible:z-10`
 *      instead of `ring-offset-background`, because the grid renders
 *      inside a popover and its 4px gutter is exactly the ring's width.
 *   3. `ui/src/primitives/tabs.tsx`'s trigger — canonical offset, but
 *      plus `focus-visible:z-10`. Same stacking problem as (2), found
 *      during [8.14.14] review rather than planning: triggers are
 *      `flex-1` siblings that are all `relative`, so the next trigger's
 *      `data-[state=active]:bg-card` paints over the focused trigger's
 *      ring without it.
 *
 * None of those trip any rule below — this gate only bans the *old*,
 * deleted spellings, not `ring-offset-*` or `z-*` variety in general.
 *
 * `aria-invalid:ring-3 aria-invalid:ring-destructive/20` is a different,
 * intentional concern (invalid-state styling, not focus) and is
 * deliberately untouched by this ticket — the `ring-3`/`ring-[3px]` rule
 * below matches only the `focus-visible:` prefixed form so it cannot
 * flag `aria-invalid:ring-3`.
 *
 * Run with `node ui/scripts/check-focus-ring.mjs`.
 *
 * NOT WIRED INTO CI YET. The `check:focus-ring` package.json entry and the
 * `scripts/ci-local.sh` / `.github/workflows/ci.yml` steps that belong
 * beside `check:raw-palette` and `check:contrast` were left out of the
 * [8.14.14] branch on purpose: those files are owned by another lane of
 * the 8.14 parallel run and editing them here would have conflicted.
 * Until they land, this gate only runs when invoked by hand.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(pkgRoot, '..');

const CANONICAL_STRING =
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * `ui/src/components/data-table.tsx` is owned by issue #371, whose
 * published plan migrates its three Pattern-C sites as part of that
 * ticket, not this one. Until #371 lands, that file legitimately still
 * carries the old vocabulary — this is the single allowlist entry the
 * plan calls for. Delete this entry once #371 lands.
 */
const ALLOWLIST = new Set([join('ui', 'src', 'components', 'data-table.tsx')]);

const RULES = [
  {
    re: /ring-ring\/50/g,
    describe: (match) =>
      `uses the deleted brand-on-brand focus ring \`${match}\` — a 50%-alpha ` +
      `ring on top of the brand ring colour is nearly invisible on a ` +
      `brand-filled control. Use the canonical string instead: \`${CANONICAL_STRING}\`.`,
  },
  {
    re: /focus-visible:border-ring\b/g,
    describe: (match) =>
      `uses the deleted \`${match}\` — border-swap is no longer part of the ` +
      `focus treatment. Use the canonical string instead: \`${CANONICAL_STRING}\`.`,
  },
  {
    re: /(?:focus-visible:)?outline-ring\b/g,
    describe: (match) =>
      `uses the deleted \`${match}\` — a bare browser outline is no longer ` +
      `part of the focus treatment (it doubled up with the ring on tabs, ` +
      `and stood alone as a third vocabulary in two client-admin call ` +
      `sites). Use the canonical string instead: \`${CANONICAL_STRING}\`.`,
  },
  {
    re: /focus-visible:ring-\[3px\]/g,
    describe: (match) =>
      `uses the deleted arbitrary-value ring \`${match}\` — this is not the ` +
      `same as \`ring-3\`, it is an easy find-and-replace trap. Use the ` +
      `canonical string instead: \`${CANONICAL_STRING}\`.`,
  },
  {
    // Word-boundary-safe: matches `focus-visible:ring-3` but not
    // `aria-invalid:ring-3` (different prefix entirely) and not a
    // `ring-30`/`ring-3xl`-shaped utility that happens to start the same
    // way (none exist today, but the negative lookahead keeps the rule
    // honest either way).
    re: /focus-visible:ring-3(?![a-z0-9-])/g,
    describe: (match) =>
      `uses the deleted \`${match}\` — the two-tone offset ring uses ` +
      `\`ring-2\`, not \`ring-3\`. Use the canonical string instead: ` +
      `\`${CANONICAL_STRING}\`.`,
  },
];

/**
 * Strip comments before scanning, same discipline as
 * `check-raw-palette.mjs` — otherwise this file's own header comment
 * (which quotes every banned spelling by name, on purpose, so the
 * remediation message above is accurate) would fail the build against
 * itself the moment it is scanned.
 */
function stripComments(source) {
  return source
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

// Test/spec files are excluded on purpose: unlike `check-raw-palette.mjs`
// (which scans classes that are always literal styling), this gate's
// banned strings are exactly the strings a negative assertion legitimately
// quotes — e.g. `expect(el.className).not.toContain('ring-ring/50')` in
// `button.test.tsx`. Excluding `*.test.ts(x)`/`*.spec.ts(x)` does not
// weaken the gate: the vocabulary lives in the component source files,
// which are still scanned, not in the tests that assert against it.
const isTestFile = (name) => /\.(?:test|spec)\.tsx?$/.test(name);
const isUiSource = (name) =>
  /\.(?:ts|tsx|css)$/.test(name) && !/\.d\.ts$/.test(name) && !isTestFile(name);
// Same extension set as `isUiSource`, `.css` included: an SPA can define a
// focus ring in its own stylesheet just as easily as `ui/src/styles/
// globals.css` can, and scanning one but not the other would leave a hole
// exactly where a fourth vocabulary is cheapest to add.
const isAppSource = isUiSource;

/** Discover SPAs instead of naming them — see `check-raw-palette.mjs` for
 * why: a hard-coded app name means a newly-added `client-*` workspace
 * gets zero scanning, silently. */
function clientApps() {
  let entries;
  try {
    entries = readdirSync(repoRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('client-'))
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(repoRoot, name, 'package.json')))
    .sort();
}

/**
 * Scan one file's contents, return human-readable violations. Exported
 * so `check-focus-ring.spec.mjs` can assert positive and negative cases
 * directly, the same shape as `check-raw-palette.mjs`'s `scanFile`.
 */
export function scanFile(displayPath, rawContents) {
  const errors = [];
  const contents = stripComments(rawContents);

  contents.split('\n').forEach((line, index) => {
    for (const rule of RULES) {
      for (const match of line.matchAll(rule.re)) {
        errors.push(`${displayPath}:${index + 1} ${rule.describe(match[0])}`);
      }
    }
  });

  return errors;
}

export function runCheck() {
  const apps = clientApps();

  const targets = [
    ...walk(join(pkgRoot, 'src'), isUiSource),
    ...apps.flatMap((app) => walk(join(repoRoot, app, 'src'), isAppSource)),
  ];

  const errors = [];
  let scanned = 0;
  let allowlisted = 0;

  for (const file of targets) {
    const displayPath = relative(repoRoot, file);
    if (ALLOWLIST.has(displayPath)) {
      allowlisted += 1;
      continue;
    }
    let contents;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      errors.push(`${displayPath} could not be read`);
      continue;
    }
    scanned += 1;
    errors.push(...scanFile(displayPath, contents));
  }

  if (apps.length === 0) {
    errors.push(
      'no client-* app directories found next to ui/ — the workspace glob has ' +
        'moved, so no application source was scanned by this check',
    );
  }

  if (errors.length > 0) {
    console.error('check-focus-ring: FAILED\n');
    console.error(errors.join('\n'));
    console.error(
      `\nCopy the canonical focus-ring string verbatim from ` +
        `ui/src/primitives/button.tsx instead of retyping it:\n  ${CANONICAL_STRING}`,
    );
    process.exit(1);
  }

  console.log(
    `check-focus-ring: OK — ${scanned} files in ui/src and ${apps.length} client app(s) ` +
      `(${apps.join(', ')}) carry no deleted focus-ring vocabulary` +
      (allowlisted > 0 ? ` (${allowlisted} file(s) allowlisted for #371).` : '.'),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCheck();
}
