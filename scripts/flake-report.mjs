#!/usr/bin/env node
/**
 * [#437] Turns N passes of Vitest's `--reporter=json` output (the nightly
 * flake hunt in `.github/workflows/nightly-frontend-flakes.yml` runs the
 * frontend suite three times in a row) into a flake/real-failure
 * classification and a markdown report body. Pure — no filesystem or
 * network access beyond reading the pass files the CLI is given — same
 * dependency-free ESM house style as `scripts/coverage-delta.mjs` and
 * `scripts/ci-timings.mjs`.
 *
 * Classification:
 *   - **flake**: failed in at least one pass, passed in at least one pass.
 *   - **real failure**: failed in every pass — not quarantine material,
 *     reported separately so nobody mistakes a hard break for a flake.
 *
 * The workflow step around this script maintains the *one* sticky
 * tracking issue (found by the `flake-hunt` label, created if absent,
 * edited otherwise) — this script only produces the markdown body; it
 * does not talk to the GitHub API itself, so it stays testable with
 * plain fixtures.
 *
 * Usage: node scripts/flake-report.mjs <pass1.json> <pass2.json> ...
 * Exit 0 = report written (green or not). Exit 1 = bad usage. Exit 2 = no
 * pass file had any results, so there is nothing trustworthy to say; the
 * workflow leaves the tracking issue untouched rather than overwriting a
 * real flake table with a false "all green". Never non-zero merely because
 * tests failed — this is a report, not a gate (#437's retry-policy AC).
 */
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, resolved from this file's own location (`scripts/`). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * One pass's Vitest `--reporter=json` output → `{ key, file, testName,
 * status }[]`, one entry per assertion.
 *
 * `key` must match `ui/src/test/quarantine.ts`'s `repoRelativeKey` exactly,
 * because the whole point of this report is that its `test` values can be
 * pasted straight into `quarantine.json`. Two conversions are needed and
 * neither is optional:
 *   - `testResults[].name` is an ABSOLUTE path; the key is repo-relative.
 *   - `assertionResults[].fullName` joins the suite chain with a single
 *     SPACE; the key joins with `' > '`. Use `ancestorTitles` + `title`
 *     instead, which is what Vitest builds `fullName` from.
 * Getting either wrong produces a key that can never match a quarantine
 * entry, so quarantining a test this report found would silently do
 * nothing — see `flake-report.spec.mjs`'s round-trip test.
 */
export function extractResults(passReport, repoRoot = REPO_ROOT) {
  const testResults = Array.isArray(passReport?.testResults) ? passReport.testResults : [];
  return testResults.flatMap((fileResult) => {
    const file = fileResult.name ?? 'unknown file';
    const relFile = file === 'unknown file' ? file : relative(repoRoot, file);
    const assertions = fileResult.assertionResults ?? [];
    return assertions.map((assertion) => {
      const titles = [...(assertion.ancestorTitles ?? []), assertion.title].filter(Boolean);
      const testName = titles.length ? titles.join(' > ') : (assertion.fullName ?? 'unknown test');
      return {
        key: `${relFile} > ${testName}`,
        file: relFile,
        testName,
        status: assertion.status ?? 'unknown',
      };
    });
  });
}

/**
 * Every pass's results, merged by `key`. A pass file that fails to parse
 * (crashed run, truncated upload) degrades to "no results from this
 * pass" rather than taking the whole report down — the report's only
 * consumer is a tracking issue, nobody is gated on it.
 */
export function classify(passReports, repoRoot = REPO_ROOT) {
  const byKey = new Map();
  passReports.forEach((passReport, passIndex) => {
    for (const result of extractResults(passReport, repoRoot)) {
      if (!byKey.has(result.key)) {
        byKey.set(result.key, { file: result.file, testName: result.testName, statuses: [] });
      }
      byKey.get(result.key).statuses[passIndex] = result.status;
    }
  });

  const flaky = [];
  const realFailures = [];
  const inconclusive = [];
  for (const [key, entry] of byKey) {
    // Pad rather than compact. A test can be absent from a pass (its file
    // crashed on import, or it was renamed mid-hunt), leaving a hole in the
    // array. Compacting with `.filter(Boolean)` would shift later results
    // left, so the ✅/❌ row would blame the wrong pass — and a test that
    // failed pass 1 then vanished would show zero passes and be reported as
    // a hard failure ("do not quarantine") when it is the flakiest shape
    // there is.
    const statuses = Array.from(
      { length: passReports.length },
      (_, i) => entry.statuses[i] ?? 'missing',
    );
    const failedCount = statuses.filter((s) => s === 'failed').length;
    const passedCount = statuses.filter((s) => s === 'passed').length;
    const missingCount = statuses.filter((s) => s === 'missing').length;
    if (failedCount === 0) continue;
    const record = { key, file: entry.file, testName: entry.testName, statuses };
    // "Failed every single pass" is the only shape that is definitely not a
    // flake. Any other status mixed in — passed, skipped, pending, todo,
    // disabled — is evidence the test doesn't reliably fail, so it counts
    // as flaky rather than a hard failure. The one exception is a test
    // that never actually passed but was sometimes absent from a pass
    // (import crash, rename mid-hunt) and never anything else either —
    // that's not evidence of flakiness, it could be hiding a real,
    // consistent failure, so it goes to `inconclusive` instead of `flaky`,
    // which is reserved for tests observed to both fail and do something
    // other than fail or go missing.
    const otherCount = statuses.length - failedCount - missingCount;
    if (failedCount === statuses.length) realFailures.push(record);
    else if (otherCount > 0) flaky.push(record);
    else inconclusive.push(record);
  }
  flaky.sort((a, b) => a.key.localeCompare(b.key));
  realFailures.sort((a, b) => a.key.localeCompare(b.key));
  inconclusive.sort((a, b) => a.key.localeCompare(b.key));
  return { flaky, realFailures, inconclusive, passCount: passReports.length };
}

function fmtStatuses(statuses) {
  return statuses
    .map((s) => (s === 'passed' ? '✅' : s === 'failed' ? '❌' : s === 'missing' ? '·' : s))
    .join(' ');
}

/** Sticky-issue body markdown. Kept stable across runs — the workflow
 * step edits the same issue in place rather than filing a new one every
 * night, so the diff between two nights' bodies is the useful signal. */
export function buildReportMarkdown({ flaky, realFailures, inconclusive = [], passCount }) {
  const lines = [];
  lines.push('### Nightly frontend flake hunt');
  lines.push('');
  lines.push(`Last run: ${new Date().toISOString()} — ${passCount} consecutive passes.`);
  lines.push('');

  if (flaky.length === 0 && realFailures.length === 0 && inconclusive.length === 0) {
    lines.push(`All green across ${passCount} passes. No flakes, no failures.`);
    return lines.join('\n') + '\n';
  }

  if (flaky.length > 0) {
    lines.push('#### Flaky (failed at least once, passed at least once)');
    lines.push('');
    lines.push(
      'Copy the `test` value verbatim into `quarantine.json` (see `ui/src/test/quarantine.ts`).',
    );
    lines.push('');
    lines.push('| Passes | Test |');
    lines.push('|---|---|');
    for (const entry of flaky) {
      lines.push(`| ${fmtStatuses(entry.statuses)} | \`${entry.key}\` |`);
    }
    lines.push('');
  }

  if (realFailures.length > 0) {
    lines.push('#### Failed every pass (not a flake — do not quarantine)');
    lines.push('');
    lines.push('| Passes | Test |');
    lines.push('|---|---|');
    for (const entry of realFailures) {
      lines.push(`| ${fmtStatuses(entry.statuses)} | \`${entry.key}\` |`);
    }
    lines.push('');
  }

  if (inconclusive.length > 0) {
    lines.push(
      '#### Inconclusive (never observed passing, missing from at least one pass — do not quarantine)',
    );
    lines.push('');
    lines.push(
      'A missing result usually means a crashed import or a rename mid-hunt, not a pass. ' +
        'This could be masking a real, consistent failure — investigate rather than quarantine.',
    );
    lines.push('');
    lines.push('| Passes | Test |');
    lines.push('|---|---|');
    for (const entry of inconclusive) {
      lines.push(`| ${fmtStatuses(entry.statuses)} | \`${entry.key}\` |`);
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`flake-report: skipping unreadable pass file ${path}: ${e.message}`);
    return { testResults: [] };
  }
}

function main(argv) {
  const paths = argv.slice(2);
  if (paths.length === 0) {
    console.error('usage: flake-report.mjs <pass1.json> <pass2.json> ...');
    process.exit(1);
  }
  const passReports = paths.map(readJsonSafe);

  // "No results at all" and "all green" look identical downstream but mean
  // opposite things. If the runner died, `yarn install` failed, or the shell
  // glob matched nothing and passed its literal string through, every pass
  // parses to `{testResults: []}` and the report would read "All green" —
  // which the workflow would then write over a real flake table from a
  // previous night. Exit 2 so the caller can tell "nothing to say" from
  // "nothing went wrong" and leave the tracking issue alone.
  const totalResults = passReports.reduce((n, r) => n + extractResults(r).length, 0);
  if (totalResults === 0) {
    console.error(
      `flake-report: none of the ${paths.length} pass file(s) contained any test results — refusing to report "all green".`,
    );
    process.exit(2);
  }

  const { flaky, realFailures, inconclusive, passCount } = classify(passReports);
  // No explicit process.exit(0): an exit() here would truncate stdout if the
  // caller ever pipes this instead of redirecting to a file.
  process.stdout.write(buildReportMarkdown({ flaky, realFailures, inconclusive, passCount }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv);
