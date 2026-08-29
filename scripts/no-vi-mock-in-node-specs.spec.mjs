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

const BANNED = [/\bvi\s*\.\s*mock\s*\(/, /\bvi\s*\.\s*doMock\s*\(/, /\bvi\s*\.\s*unmock\s*\(/];

function walk(dir, suffix, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // A project directory that doesn't exist yet is not a failure.
  }
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
        if (BANNED.some((re) => re.test(source))) {
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
