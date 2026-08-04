#!/usr/bin/env node
/**
 * Validate the package's public surface.
 *
 * Two failure modes this guards against, both of which are silent until an SPA
 * breaks:
 *
 *  1. An `exports` entry pointing at a file that does not exist. Because the
 *     package is consumed as source through a bundler alias rather than by
 *     Node's own resolver, a broken entry does not fail at install time — it
 *     fails much later, in whichever app first imports that subpath.
 *
 *  2. `primitives/` becoming publicly exported. Vendored shadcn output is meant
 *     to be unreachable from an SPA so that customisation stays in the wrapper
 *     layer. That rule is only real if something enforces it.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));

/** Directories under src/ that are intentionally not part of the public API. */
const PRIVATE_DIRS = new Set(['primitives']);

const errors = [];
const entries = Object.entries(pkg.exports ?? {});

if (entries.length === 0) {
  errors.push('package.json declares no "exports" map.');
}

for (const [subpath, target] of entries) {
  if (typeof target !== 'string') {
    errors.push(`${subpath}: conditional exports are not supported here; use a plain path.`);
    continue;
  }
  if (!existsSync(join(pkgRoot, target))) {
    errors.push(`${subpath} -> ${target} does not exist.`);
  }
  for (const priv of PRIVATE_DIRS) {
    if (target.includes(`/${priv}/`)) {
      errors.push(
        `${subpath} -> ${target} exposes ${priv}/, which must stay internal. ` +
          `Wrap it in src/components/ and export the wrapper instead.`,
      );
    }
  }
}

// Every public directory under src/ should be reachable. A new directory that
// nobody exported is either dead or an oversight; both are worth surfacing.
const srcDir = join(pkgRoot, 'src');
const exported = new Set(Object.values(pkg.exports ?? {}));
for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || PRIVATE_DIRS.has(entry.name)) continue;
  const barrel = `./src/${entry.name}/index.ts`;
  const hasBarrel = existsSync(join(pkgRoot, barrel));
  if (!hasBarrel) continue; // styles/ holds css, not a barrel
  if (!exported.has(barrel)) {
    errors.push(`src/${entry.name}/ has a barrel but no "exports" entry — add one or delete it.`);
  }
}

if (errors.length > 0) {
  console.error('check-exports: FAILED\n');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`check-exports: OK — ${entries.length} subpaths resolve, ${[...PRIVATE_DIRS].join(', ')} stays internal.`);
