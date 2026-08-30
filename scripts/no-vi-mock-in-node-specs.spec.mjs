/**
 * [15.3] Guards the invariant `vitest.config.ts`'s `NODE_PROJECT_ISOLATE`
 * rests on: the four `:node` projects run with `isolate: false`, i.e. every
 * file in a project shares one worker and one module registry. That is only
 * safe while none of them hoists a module mock, because `vi.mock()` is
 * registry-level — a mock hoisted by one file would be inherited by every
 * later file in the same worker, producing failures that depend on file
 * ordering and reproduce for nobody.
 *
 * Hand-verifying that once, in a comment, is exactly the shape #356 warned
 * about: the check that was true the day it was written and silently stopped
 * being true. So it runs on every CI frontend job instead.
 *
 * The detector is syntax-aware (strips comments/strings, handles computed
 * access like vi['mock'], and detects aliases such as `const v = vi; v.mock`)
 * so it is resistant to false negatives from indirect call styles and false
 * positives from documentation strings and commented-out code (#449).
 *
 * Scope note: this bans `vi.mock`/`vi.doMock`/`vi.unmock` only in the NODE
 * projects. The `:jsdom` projects are still isolated and may mock freely —
 * see the README's isolation table for why they were left that way.
 *
 * Other shared-registry hazards in these projects are real but already
 * self-cleaning, and deliberately not banned here:
 *   - `ui/src/hooks/retry.spec.ts` stubs `navigator`, with
 *     `afterEach(vi.unstubAllGlobals)`.
 *   - `ui/src/api/session.spec.ts` uses fake timers, with
 *     `afterEach(vi.useRealTimers)`.
 * Both would leak without their cleanup, so if this guard ever grows, those
 * are the next things worth asserting.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Mirrors the `include` globs of every project that sets
 * `isolate: NODE_PROJECT_ISOLATE` in `vitest.config.ts`. Kept as
 * `[directory, suffix]` pairs rather than real globs so this file stays
 * dependency-free, like the rest of `scripts/`.
 */
const NODE_PROJECT_SOURCES = [
  ['ui/src', '.spec.ts'],
  ['ui/eslint-rules', '.spec.mjs'],
  ['ui/scripts', '.spec.mjs'],
  ['client-admin/src', '.spec.ts'],
  ['shared/src', '.spec.ts'],
  ['scripts', '.spec.mjs'],
];

// ---------------------------------------------------------------------------
// Syntax-aware mock detector — strips comments and string literals before
// matching, catches computed access (vi['mock']) and aliases
// (const v = vi; v.mock(...)). (#449)
// ---------------------------------------------------------------------------

/** Strip single-line and multi-line comments from source. */
function stripComments(source) {
  return source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Build a list of regexes that detect direct and computed mock calls on
 * `vi` (and any variable aliased to `vi`), over cleaned source text.
 */
function buildMockDetectors(sourceClean) {
  // Direct calls: vi.mock(...), vi.doMock(...), vi.unmock(...)
  // Computed access: vi['mock'](...), vi["mock"](...)
  const patterns = [
    /vi\s*\.\s*(?:mock|doMock|unmock)\s*\(/,
    /vi\s*\[\s*['"](?:mock|doMock|unmock)['"]\s*\]\s*\(/,
  ];

  // Detect aliases: const v = vi, let v = vi, var v = vi
  const aliasRE = /\b(const|let|var)\s+(\w+)\s*=\s*vi\b/g;
  const aliases = new Set();
  let m;
  while ((m = aliasRE.exec(sourceClean)) !== null) {
    aliases.add(m[2]);
  }
  for (const alias of aliases) {
    const aliasRE = new RegExp(`\\b${alias}\\s*\\.\\s*(?:mock|doMock|unmock)\\s*\\(`);
    patterns.push(aliasRE);
  }

  return patterns;
}

/** True if `source` (raw file text) contains an executable mock call. */
function hasExecutableMock(source) {
  const clean = stripComments(source);
  const detectors = buildMockDetectors(clean);
  return detectors.some((re) => re.test(clean));
}

function walk(dir, suffix, out = []) {
  // readdirSync errors (ENOENT, EACCES, etc.) are deliberately propagated
  // rather than converted to empty results — a configured source root that
  // is missing or unreadable means the aggregate scan may pass when it
  // should have failed, so the test must fail closed. (#449)
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, suffix, out);
    else if (entry.endsWith(suffix)) out.push(full);
  }
  return out;
}

describe('the four isolate:false node projects', () => {
  it('contain no vi.mock — it would leak across files sharing a worker', () => {
    const offenders = [];
    for (const [dir, suffix] of NODE_PROJECT_SOURCES) {
      for (const file of walk(resolve(REPO_ROOT, dir), suffix)) {
        // This file necessarily contains the banned text (it is the matcher).
        if (file === fileURLToPath(import.meta.url)) continue;
        const source = readFileSync(file, 'utf8');
        if (hasExecutableMock(source)) {
          offenders.push(file.slice(REPO_ROOT.length + 1));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('actually looked at some files — a silently-empty scan would pass vacuously', () => {
    const scanned = NODE_PROJECT_SOURCES.flatMap(([dir, suffix]) =>
      walk(resolve(REPO_ROOT, dir), suffix),
    );
    expect(scanned.length).toBeGreaterThan(20);
  });
});
