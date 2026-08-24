#!/usr/bin/env node
/**
 * Populate `ui/.design-sync-compiled.css` — the gitignored scratch copy
 * `.design-sync/config.json`'s `cssEntry` points at.
 *
 * `ui` ships no static compiled CSS (Tailwind v4 generates utilities
 * per-consuming-app, not inside `ui/` itself), and the reference
 * Storybook build doesn't emit a static `<link rel="stylesheet">` for the
 * design-sync CSS scraper to find — the CSS loads via a JS-injected
 * `<style>` at runtime instead. So this script pulls the real compiled
 * CSS straight out of the reference Storybook build's own Vite output.
 *
 * Run via `yarn design-sync:css`, which builds the reference Storybook
 * first — this script only does the copy, and fails loudly rather than
 * silently leaving a stale or missing `cssEntry` behind.
 */

import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(pkgRoot, '..');
const assetsDir = join(repoRoot, '.design-sync', 'sb-reference', 'assets');
const dest = join(pkgRoot, '.design-sync-compiled.css');

if (!existsSync(assetsDir)) {
  console.error(
    `sync-design-css: FAILED — ${assetsDir} does not exist.\n` +
      '  Build the reference Storybook first (this script is meant to run after it, ' +
      'via `yarn design-sync:css`, not on its own).',
  );
  process.exit(1);
}

// The filename's content hash changes every build, so match by prefix
// rather than a fixed name. Storybook 8 emitted the global stylesheet as
// `preview-*.css`; Storybook 10 renamed the chunk to `iframe-*.css`.
const matches = readdirSync(assetsDir).filter(
  (name) => (name.startsWith('preview-') || name.startsWith('iframe-')) && name.endsWith('.css'),
);

if (matches.length === 0) {
  console.error(
    `sync-design-css: FAILED — no preview-*.css/iframe-*.css asset found in ${assetsDir}.\n` +
      "  Storybook's Vite build may have changed how it names or emits this file — " +
      'see .design-sync/NOTES.md\'s "cfg.cssEntry" entry before changing this script.',
  );
  process.exit(1);
}

if (matches.length > 1) {
  console.error(
    `sync-design-css: FAILED — ${matches.length} preview-*.css/iframe-*.css assets found in ${assetsDir}, expected exactly 1:\n` +
      matches.map((name) => `    ${name}`).join('\n') +
      '\n  Picking one at random would silently ship the wrong stylesheet — resolve the ambiguity first.',
  );
  process.exit(1);
}

copyFileSync(join(assetsDir, matches[0]), dest);
console.log(`sync-design-css: OK — copied ${matches[0]} -> ui/.design-sync-compiled.css`);
