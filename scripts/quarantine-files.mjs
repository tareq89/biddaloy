#!/usr/bin/env node
/**
 * [18.1.1] Turns `quarantine.json` into the list of files ci.yml's
 * "Quarantined frontend tests (non-blocking)" step should actually run.
 *
 * That step used to run `QUARANTINE_MODE=only yarn test:frontend --run`
 * with no file arguments whenever the list was non-empty. `QUARANTINE_MODE`
 * skips every test that ISN'T listed, but Vitest still has to transform,
 * import and set up all ~200 frontend test files first to find that out —
 * a second near-full frontend run, on every PR, for a handful of tests.
 * This script prints just the unique file paths quarantine.json's entries
 * live in, so the step can pass them straight to `yarn test:frontend --run`
 * and skip the rest of the suite entirely.
 *
 * Each entry's `test` field is `<repo-relative file> > <suite> > ... >
 * <name>` — see `ui/src/test/quarantine.ts`'s module header for the exact
 * format and why the file segment is repo-relative rather than
 * package-relative. This script only needs the part before the first
 * `' > '`.
 *
 * Usage: node scripts/quarantine-files.mjs
 * Prints one file path per line, exit 0. Prints nothing (and still exits 0)
 * when quarantine.json has no entries, or doesn't exist — same
 * dependency-free ESM house style as `scripts/flake-report.mjs`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, resolved from this file's own location (`scripts/`). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_QUARANTINE_PATH = resolve(REPO_ROOT, 'quarantine.json');

/**
 * Pure: `quarantine.json`'s parsed `tests` array → unique, ordered file
 * paths. Tolerant of malformed entries (mirrors `ui/src/test/quarantine.ts`'s
 * `installQuarantine` — a bad entry should never crash this script, since
 * `quarantine.spec.ts` is the blocking check responsible for catching that).
 */
export function quarantineFiles(entries) {
  const files = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry === null || typeof entry !== 'object' || typeof entry.test !== 'string') continue;
    const separatorIndex = entry.test.indexOf(' > ');
    const file = separatorIndex === -1 ? entry.test : entry.test.slice(0, separatorIndex);
    if (file.trim().length === 0 || seen.has(file)) continue;
    seen.add(file);
    files.push(file);
  }
  return files;
}

export function loadQuarantineTests(path = DEFAULT_QUARANTINE_PATH) {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(parsed?.tests) ? parsed.tests : [];
}

function main() {
  const files = quarantineFiles(loadQuarantineTests());
  for (const file of files) {
    console.log(file);
  }
}

// Only run when invoked directly (`node scripts/quarantine-files.mjs`), not
// when imported by `quarantine-files.spec.mjs`.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
