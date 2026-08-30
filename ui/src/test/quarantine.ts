/**
 * [#437] Quarantine is a queue, not a graveyard. A quarantined test still
 * RUNS — it just runs in a separate, non-blocking `QUARANTINE_MODE=only`
 * pass in CI instead of the main gating one, so it stops failing the
 * pipeline while its tracking issue is open, but nobody forgets it exists.
 * `quarantine.spec.ts` enforces a hard cap and a 14-day expiry on
 * `quarantine.json`, so the list can't quietly grow into a place broken
 * tests go to die — the escape hatch has its own escape hatch.
 *
 * ```mermaid
 * flowchart LR
 *   A[Test fails in CI] --> B{Real bug or flake?}
 *   B -- real bug --> C[Fix it]
 *   B -- flake --> D["Add to quarantine.json\n(test, issue, addedAt, reason)"]
 *   D --> E["Runs non-blocking in CI\n(QUARANTINE_MODE=only)"]
 *   E --> F{Fixed within 14 days?}
 *   F -- yes --> G[Remove from quarantine.json]
 *   F -- no --> H["quarantine.spec.ts fails the\nfrontend job — expired entry"]
 * ```
 *
 * Key format: `<repo-relative file> > <outer suite> > ... > <test name>`.
 * This is the tail Vitest prints on a FAIL line, with ONE edit: Vitest's
 * path is relative to the *project* root, so prefix it with the package
 * directory. `|client-admin:jsdom|` below means the package is
 * `client-admin/`:
 *
 * ```text
 * FAIL  |client-admin:jsdom| src/routes/_staff/students/index.test.tsx > /students > gates Collect fees by permission
 *                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *                            this part, prefixed with `client-admin/`, is the "test" field:
 *
 * "client-admin/src/routes/_staff/students/index.test.tsx > /students > gates Collect fees by permission"
 * ```
 *
 * The prefix is not decoration: `src/…` alone is ambiguous between `ui` and
 * `client-admin`, and `scripts/flake-report.mjs` — which only sees absolute
 * paths in Vitest's JSON report — emits this same repo-relative shape so its
 * output can be pasted in verbatim.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, type TestContext } from 'vitest';

// Not exported — nothing outside this file needs it; `loadQuarantine`'s
// missing-file fallback is the only consumer.
const QUARANTINE_SCHEMA_VERSION = 1;

/** Hard cap on the number of concurrently quarantined tests (#437 AC). */
export const MAX_QUARANTINE_ENTRIES = 10;

/** An entry older than this many days fails `quarantine.spec.ts` — the
 * frontend job's normal-blocking bucket, not the non-blocking one. */
export const QUARANTINE_EXPIRY_DAYS = 14;

export interface QuarantineEntry {
  /** `ctx.task.fullName` — see the module header for the exact shape. */
  test: string;
  /** Tracking issue number — e.g. `445` for `#445`. */
  issue: number;
  /** ISO date (`YYYY-MM-DD`) the entry was added; drives the expiry. */
  addedAt: string;
  reason: string;
}

export interface QuarantineFile {
  schemaVersion: number;
  tests: QuarantineEntry[];
}

// `quarantine.json` sits at the repo root, next to `knip.json` — not
// inside the `ui` workspace, since it lists tests from every frontend
// package, not just `ui`'s own. Resolved from this file's own URL rather
// than `process.cwd()` because Vitest's `projects` mode runs suites with
// different `root`s (`ui`, `client-admin`, `shared`, repo root for
// `scripts:node`) — a `cwd`-relative path would only be correct in one of
// them.
const DEFAULT_QUARANTINE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../quarantine.json',
);

export function loadQuarantine(path: string = DEFAULT_QUARANTINE_PATH): QuarantineFile {
  if (!existsSync(path)) {
    return { schemaVersion: QUARANTINE_SCHEMA_VERSION, tests: [] };
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<QuarantineFile>;
  // `tests` absent would otherwise throw inside every frontend file's setup.
  return {
    schemaVersion: parsed.schemaVersion ?? QUARANTINE_SCHEMA_VERSION,
    tests: parsed.tests ?? [],
  };
}

export type QuarantineMode = 'skip' | 'only';

/** `QUARANTINE_MODE` env var → mode. Anything other than the literal
 * string `'only'` — including unset — means the normal, gating pass:
 * skip whatever is listed, run everything else. */
export function resolveQuarantineMode(raw: string | undefined): QuarantineMode {
  return raw === 'only' ? 'only' : 'skip';
}

/**
 * A quarantine entry is "expired" once it's more than `QUARANTINE_EXPIRY_DAYS`
 * old — measured against `now` so this is testable without a real clock.
 */
export function isExpired(entry: QuarantineEntry, now: Date = new Date()): boolean {
  const added = new Date(entry.addedAt);
  if (Number.isNaN(added.getTime())) return true;
  const ageMs = now.getTime() - added.getTime();
  return ageMs > QUARANTINE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * The queue-not-graveyard rules, as a pure function so `quarantine.spec.ts`
 * can exercise every violation without touching the real file. Returns one
 * message per violation; an empty array means the file is healthy.
 */
export function validateQuarantineFile(file: QuarantineFile, now: Date = new Date()): string[] {
  const violations: string[] = [];

  if (file.schemaVersion !== QUARANTINE_SCHEMA_VERSION) {
    violations.push(
      `quarantine.json has schemaVersion ${file.schemaVersion}, expected ${QUARANTINE_SCHEMA_VERSION}.`,
    );
  }

  // A hand-edited quarantine.json can have `tests` as anything — a
  // string, an object, entirely absent past `loadQuarantine`'s `?? []`
  // fallback (which only catches `undefined`, not other wrong types).
  // Report it as a violation and stop, rather than let `.length`/the
  // loop below throw and abort every frontend test file's setup.
  if (!Array.isArray(file.tests)) {
    violations.push(`quarantine.json's "tests" field must be an array, got ${typeof file.tests}.`);
    return violations;
  }

  if (file.tests.length > MAX_QUARANTINE_ENTRIES) {
    violations.push(
      `quarantine.json has ${file.tests.length} entries, over the hard cap of ${MAX_QUARANTINE_ENTRIES} — fix or drop one before adding another.`,
    );
  }

  const seen = new Set<string>();
  for (const entry of file.tests) {
    // An entry that isn't even an object (`null`, a bare string, ...)
    // would throw on `entry.test` below — report it and move on instead.
    if (entry === null || typeof entry !== 'object') {
      violations.push(`quarantine.json has a malformed entry (${JSON.stringify(entry)}), expected an object.`);
      continue;
    }
    // A missing/blank/non-string "test" installs as `undefined` in
    // `installQuarantine`'s Set — no entry ever matches it, so the test
    // the author meant to quarantine keeps running in the blocking pass
    // while the file itself looks valid.
    if (typeof entry.test !== 'string' || entry.test.trim().length === 0) {
      violations.push(
        `quarantine entry has a missing, empty, or non-string "test" field (${JSON.stringify(entry.test)}) — it would never match anything.`,
      );
      continue;
    }

    if (seen.has(entry.test)) {
      violations.push(`duplicate quarantine entry for "${entry.test}".`);
    }
    seen.add(entry.test);

    if (!entry.issue) {
      violations.push(`quarantine entry "${entry.test}" is missing a tracking "issue" number.`);
    }
    if (!entry.reason) {
      violations.push(`quarantine entry "${entry.test}" is missing a "reason".`);
    }
    if (!entry.addedAt) {
      violations.push(`quarantine entry "${entry.test}" is missing "addedAt".`);
    } else if (isExpired(entry, now)) {
      violations.push(
        `quarantine entry "${entry.test}" was added ${entry.addedAt}, more than ${QUARANTINE_EXPIRY_DAYS} days ago — fix the test or extend the deadline explicitly.`,
      );
    }
  }

  return violations;
}

/**
 * Registers one `beforeEach` that skips quarantined tests (default mode)
 * or skips everything *except* quarantined tests (`QUARANTINE_MODE=only`,
 * used by ci.yml's non-blocking "Quarantined frontend tests" step).
 *
 * Called once from `ui/src/test/setup.ts`, which is `setupFiles` for every
 * frontend Vitest project — no `vitest.config.ts` change needed.
 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * `ctx.task.fullName`'s leading path segment is relative to the *project*
 * root (`ui`, `client-admin`, `shared`, repo root for `scripts:node`), so
 * `src/foo.test.tsx > ...` is ambiguous across packages — a single entry
 * would skip same-named tests in both `ui` and `client-admin`. Swapping in
 * the repo-relative path disambiguates them, and gives `scripts/flake-report.mjs`
 * a key shape it can reproduce from a Vitest JSON report (which only ever
 * has absolute paths to work from).
 */
export function repoRelativeKey(
  fullName: string,
  filepath: string | undefined,
  repoRoot: string = REPO_ROOT,
): string {
  if (!filepath) return fullName;
  const rel = relative(repoRoot, filepath);
  const i = fullName.indexOf(' > ');
  return i === -1 ? rel : `${rel}${fullName.slice(i)}`;
}

// `quarantine.spec.ts` IS the cap/expiry enforcement mechanism (see its
// own header). If its tests could be listed in `quarantine.json` like any
// other test, a compromised entry there would skip the very check meant
// to catch a compromised entry, in the blocking pass, silently. Matched
// by file rather than by exact test name so renaming an `it(...)` block
// inside it can't quietly disable this exemption.
const QUARANTINE_SPEC_FILE = 'ui/src/test/quarantine.spec.ts';

export function installQuarantine({
  path = DEFAULT_QUARANTINE_PATH,
  mode = resolveQuarantineMode(process.env.QUARANTINE_MODE),
}: { path?: string; mode?: QuarantineMode } = {}): void {
  // Tolerant, not validating: a malformed quarantine.json must not crash
  // every frontend test file's setup. `quarantine.spec.ts`'s blocking
  // check is what's supposed to catch and report the malformed shape —
  // this just has to survive it without throwing, treating anything it
  // can't make sense of as "not quarantined" (the safe default).
  const rawTests = loadQuarantine(path).tests;
  const listed = new Set(
    (Array.isArray(rawTests) ? rawTests : [])
      .filter(
        (entry): entry is QuarantineEntry =>
          entry !== null && typeof entry === 'object' && typeof (entry as QuarantineEntry).test === 'string',
      )
      .map((entry) => entry.test),
  );

  beforeEach((ctx: TestContext) => {
    const key = repoRelativeKey(ctx.task.fullName, ctx.task.file?.filepath);
    // Only exempt from the blocking pass — in the non-blocking `only`
    // pass, normal filtering is harmless (it just means this file
    // doesn't run there unless something deliberately lists it).
    if (mode === 'skip' && key.startsWith(`${QUARANTINE_SPEC_FILE} > `)) return;
    const isListed = listed.has(key);
    const shouldSkip = mode === 'only' ? !isListed : isListed;
    if (shouldSkip) ctx.skip();
  });
}
