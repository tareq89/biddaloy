#!/usr/bin/env node
/**
 * [15.1] Per-suite CI timing: normalize raw Vitest/Playwright JSON reports
 * into one small schema, then turn a directory of those records plus the
 * GitHub Jobs API response into the "CI timings & budgets" job-summary
 * markdown — wall/work/gap, a per-job budget verdict, and the top-10
 * slowest files. Dependency-free ESM, `node:fs`/`node:path` only, same
 * house style as `coverage-delta.mjs` and `ui/scripts/check-i18n-keys.mjs`.
 *
 * Pipeline: raw reporter JSON --collect--> normalized record (one per
 * suite, `ci-timings/<suite>.json`) --summarize--> job-summary markdown.
 *
 * ```mermaid
 * flowchart LR
 *     R["raw JSON\n(vitest --reporter=json /\nplaywright json reporter)"] -- collect --> N["normalized record\nci-timings/<suite>.json"]
 *     N -- upload-artifact --> A["ci-timings-<suite>\nartifact"]
 *     A -- gh run download --> D["ci-timings/ dir\n(one job, all suites)"]
 *     D -- summarize --> S["job summary markdown\n(GITHUB_STEP_SUMMARY)"]
 * ```
 *
 * Usage:
 *   node scripts/ci-timings.mjs collect --runner vitest|playwright \
 *     --suite <id> --job "<job name>" --in <raw.json> --out <record.json>
 *   node scripts/ci-timings.mjs summarize --records <dir> --jobs <jobs.json> \
 *     --budgets <budgets.json> [--out <path>]
 *   node scripts/ci-timings.mjs report <record.json>...
 *
 * `collect` never throws on a missing or corrupt `--in` file — a suite that
 * crashed before writing a report, or was path-filtered out entirely,
 * still needs *some* record so `summarize` can say "0" instead of silently
 * dropping the suite. It writes a zeroed record with an `error` field and
 * exits 0.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Project derivation (Vitest only — the JSON reporter carries no project
// field, verified against a real `--project shared:node` run). This
// necessarily duplicates vitest.config.ts's `frontendPackage()` include
// patterns; if those patterns change, this silently mislabels a file's
// `project` column — never its duration, which comes straight from the
// report. See vitest.config.ts's `scripts:node` project comment.
// ---------------------------------------------------------------------------
export function deriveVitestProject(repoRelativeFile) {
  const segments = repoRelativeFile.split('/');
  const [first] = segments;

  if (first === 'server') return 'server';
  // Repo-root `scripts/` is a real Vitest project (`scripts:node`, added by
  // [15.1]) — without this it reports as an unattributed `null`, which is
  // how ci-timings' own specs would have shown up in ci-timings' own report.
  if (first === 'scripts') return 'scripts:node';
  if (first !== 'ui' && first !== 'client-admin' && first !== 'shared') return null;

  // shared/vitest.config.ts's include is `src/**/*.spec.ts` only — no
  // `.test.ts` bucket exists for it, so it is always `shared:node`.
  if (first === 'shared') return 'shared:node';

  if (/\.test\.tsx?$/.test(repoRelativeFile)) return `${first}:jsdom`;
  if (/\.spec\.(ts|mjs)$/.test(repoRelativeFile)) return `${first}:node`;
  return null;
}

/** POSIX-separated, repo-root-relative — never an absolute path. */
function toRepoRelative(repoRoot, absoluteOrRelativePath) {
  const abs = resolve(repoRoot, absoluteOrRelativePath);
  return relative(repoRoot, abs).split('\\').join('/');
}

// ---------------------------------------------------------------------------
// Vitest normalization — shape verified by running
// `--reporter=json --outputFile=<path>` against a real project.
// ---------------------------------------------------------------------------
export function buildVitestRecord({ raw, suite, job, repoRoot }) {
  const testResults = raw.testResults ?? [];
  const startTime = raw.startTime ?? 0;
  const endTimes = testResults.map((t) => t.endTime ?? t.startTime ?? startTime);
  const wallMs = endTimes.length > 0 ? Math.max(...endTimes) - startTime : 0;

  let workMs = 0;
  let failed = 0;
  let skipped = 0;
  const files = testResults.map((t) => {
    const fileWorkMs = (t.endTime ?? t.startTime ?? 0) - (t.startTime ?? 0);
    workMs += fileWorkMs;
    const assertions = t.assertionResults ?? [];
    for (const a of assertions) {
      if (a.status === 'failed') failed += 1;
      // Vitest's JSON reporter has no single "skipped" bucket — 'pending'
      // covers both `it.skip` and `it.todo`.
      if (a.status === 'pending' || a.status === 'skipped') skipped += 1;
    }
    return {
      file: toRepoRelative(repoRoot, t.name),
      project: deriveVitestProject(toRepoRelative(repoRoot, t.name)),
      durationMs: fileWorkMs,
      tests: assertions.length,
      status: t.status ?? 'unknown',
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    suite,
    runner: 'vitest',
    job,
    startedAt: new Date(startTime).toISOString(),
    wallMs,
    workMs,
    totals: {
      files: files.length,
      tests: raw.numTotalTests ?? files.reduce((sum, f) => sum + f.tests, 0),
      failed,
      skipped,
      // Vitest's JSON reporter doesn't report retry/flaky info at this
      // level (that needs `--retry` plus a reporter that tracks attempts) —
      // documented gap, not an omission.
      flaky: 0,
    },
    files,
  };
}

// ---------------------------------------------------------------------------
// Playwright normalization — shape verified against a real
// `playwright.config.ts` run (`JSONReport` in
// node_modules/playwright/types/testReporter.d.ts).
// ---------------------------------------------------------------------------
function flattenPwSpecs(suites, out = []) {
  for (const s of suites ?? []) {
    for (const spec of s.specs ?? []) out.push(spec);
    if (Array.isArray(s.suites)) flattenPwSpecs(s.suites, out);
  }
  return out;
}

export function buildPlaywrightRecord({ raw, suite, job, repoRoot }) {
  const rootDir = raw.config?.rootDir ?? repoRoot;
  const specs = flattenPwSpecs(raw.suites);

  const byFile = new Map();
  for (const spec of specs) {
    const file = toRepoRelative(repoRoot, resolve(rootDir, spec.file));
    if (!byFile.has(file))
      byFile.set(file, { tests: 0, durationMs: 0, statuses: [], project: null });
    const bucket = byFile.get(file);
    for (const test of spec.tests ?? []) {
      bucket.tests += 1;
      bucket.statuses.push(test.status);
      bucket.project ??= test.projectName ?? null;
      // All retries included: a file that only goes green on retry 2
      // genuinely cost that time, and hiding it would understate the
      // suite's real work.
      for (const result of test.results ?? []) {
        bucket.durationMs += result.duration ?? 0;
      }
    }
  }

  const files = [...byFile.entries()].map(([file, bucket]) => ({
    file,
    project: bucket.project,
    durationMs: bucket.durationMs,
    tests: bucket.tests,
    status: bucket.statuses.includes('unexpected')
      ? 'failed'
      : bucket.statuses.length > 0 && bucket.statuses.every((s) => s === 'skipped')
        ? 'skipped'
        : 'passed',
  }));

  const stats = raw.stats ?? {};
  return {
    schemaVersion: SCHEMA_VERSION,
    suite,
    runner: 'playwright',
    job,
    startedAt: stats.startTime ?? new Date(0).toISOString(),
    wallMs: stats.duration ?? 0,
    workMs: files.reduce((sum, f) => sum + f.durationMs, 0),
    totals: {
      files: files.length,
      tests:
        (stats.expected ?? 0) + (stats.unexpected ?? 0) + (stats.skipped ?? 0) + (stats.flaky ?? 0),
      failed: stats.unexpected ?? 0,
      skipped: stats.skipped ?? 0,
      flaky: stats.flaky ?? 0,
    },
    files,
  };
}

export function emptyRecord({ suite, runner, job, error }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    suite,
    runner,
    job,
    startedAt: new Date(0).toISOString(),
    wallMs: 0,
    workMs: 0,
    totals: { files: 0, tests: 0, failed: 0, skipped: 0, flaky: 0 },
    files: [],
    error,
  };
}

export function buildRecord({ runner, suite, job, rawText, repoRoot }) {
  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch (e) {
    return emptyRecord({ suite, runner, job, error: `could not parse raw report: ${e.message}` });
  }
  // Parsing succeeding only proves it was JSON, not that it was a *report*.
  // `JSON.parse('null')` and a report with a non-numeric `startTime` both
  // parse fine and then throw downstream (TypeError on `raw.testResults`,
  // RangeError from `new Date(NaN).toISOString()`). ci.yml runs this step
  // with `if: always()`, so an uncaught throw here would turn an otherwise
  // green job red over a timing record nobody was blocked on — degrade to a
  // zeroed record instead, which is what a missing file already does.
  try {
    return runner === 'playwright'
      ? buildPlaywrightRecord({ raw, suite, job, repoRoot })
      : buildVitestRecord({ raw, suite, job, repoRoot });
  } catch (e) {
    return emptyRecord({
      suite,
      runner,
      job,
      error: `parsed the raw report but could not read it as ${runner} output: ${e.message}`,
    });
  }
}

/**
 * Everything `collect` needs to turn `--in` into a record, minus the
 * fs-write and CLI-arg-validation — kept separate so a missing or corrupt
 * `--in` file (deliberately never a hard failure — see file header) is
 * testable without going through `collect()`'s `process.exit` calls.
 */
export function resolveRecord({ runner, suite, job, inPath, repoRoot }) {
  if (!existsSync(inPath)) {
    return emptyRecord({ suite, runner, job, error: `${inPath} does not exist` });
  }
  return buildRecord({ runner, suite, job, rawText: readFileSync(inPath, 'utf8'), repoRoot });
}

function readArgFlag(args, name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

function collect(args) {
  const runner = readArgFlag(args, 'runner');
  const suite = readArgFlag(args, 'suite');
  const job = readArgFlag(args, 'job');
  const inPath = readArgFlag(args, 'in');
  const outPath = readArgFlag(args, 'out');
  if (!runner || !suite || !job || !inPath || !outPath) {
    console.error(
      'usage: ci-timings.mjs collect --runner vitest|playwright --suite <id> --job "<name>" --in <raw.json> --out <record.json>',
    );
    process.exit(1);
  }

  const repoRoot = process.cwd();
  if (!existsSync(inPath)) {
    console.error(`ci-timings collect: ${inPath} does not exist — writing a zeroed record`);
  }
  const record = resolveRecord({ runner, suite, job, inPath, repoRoot });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(record, null, 2) + '\n');
  console.log(
    `Wrote ${outPath} (suite=${suite}, wallMs=${record.wallMs}, workMs=${record.workMs})`,
  );
}

// ---------------------------------------------------------------------------
// summarize — records dir + GitHub Jobs API response + budgets -> markdown.
// ---------------------------------------------------------------------------
function findJsonFilesRecursively(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      findJsonFilesRecursively(full, out);
    } else if (entry.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

function fmtSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Pure: everything summarize needs, with no fs/process side effects, so
 * tests can assert on the return value directly. `main()` below is the only
 * caller that turns this into stdout/exit-code behaviour.
 */
export function buildSummary({ records, jobs, budgets }) {
  const jobsWithTimes = jobs.filter((j) => j.started_at && j.completed_at);
  const wallMs =
    jobsWithTimes.length > 0
      ? Math.max(...jobsWithTimes.map((j) => new Date(j.completed_at).getTime())) -
        Math.min(...jobsWithTimes.map((j) => new Date(j.started_at).getTime()))
      : 0;
  const jobDurations = jobsWithTimes.map((j) => ({
    name: j.name,
    durationMs: new Date(j.completed_at).getTime() - new Date(j.started_at).getTime(),
  }));
  const workMs = jobDurations.reduce((sum, j) => sum + j.durationMs, 0);
  const longestJobMs =
    jobDurations.length > 0 ? Math.max(...jobDurations.map((j) => j.durationMs)) : 0;
  const gapMs = wallMs - longestJobMs;

  const budgetMap = budgets?.jobs ?? {};
  const globalEnforce = budgets?.burnIn?.enforce ?? false;

  const lines = [];
  lines.push('### CI timings');
  lines.push('');
  lines.push('| Wall | Work | Gap |');
  lines.push('|---|---|---|');
  lines.push(`| ${fmtSeconds(wallMs)} | ${fmtSeconds(workMs)} | ${fmtSeconds(gapMs)} |`);
  lines.push('');

  lines.push('#### Jobs');
  lines.push('');
  lines.push('| Job | Duration | Budget | Status |');
  lines.push('|---|---|---|---|');
  let anyEnforcedBreach = false;
  const warnings = [];
  for (const j of jobDurations) {
    const entry = budgetMap[j.name];
    // A malformed entry (present, but with no numeric `budgetSeconds` — e.g.
    // someone leaves only a `$comment` behind while retuning a number) must
    // read as "no budget", not as a NaN comparison that silently renders ✓
    // for every future run of that job.
    if (!entry || typeof entry.budgetSeconds !== 'number') {
      lines.push(`| ${j.name} | ${fmtSeconds(j.durationMs)} | — | — |`);
      continue;
    }
    const budgetMs = entry.budgetSeconds * 1000;
    const overMs = j.durationMs - budgetMs;
    if (overMs > 0) {
      const enforce = entry.enforce ?? globalEnforce;
      lines.push(
        `| ${j.name} | ${fmtSeconds(j.durationMs)} | ${fmtSeconds(budgetMs)} | ⚠️ over by ${fmtSeconds(overMs)} |`,
      );
      warnings.push(
        `::warning title=CI budget::${j.name} took ${fmtSeconds(j.durationMs)}, budget ${fmtSeconds(budgetMs)}`,
      );
      if (enforce) anyEnforcedBreach = true;
    } else {
      lines.push(`| ${j.name} | ${fmtSeconds(j.durationMs)} | ${fmtSeconds(budgetMs)} | ✓ |`);
    }
  }
  lines.push('');

  lines.push('#### Suites');
  lines.push('');
  lines.push('| Suite | Runner | Files | Tests | Wall | Work |');
  lines.push('|---|---|---|---|---|---|');
  if (records.length === 0) {
    lines.push('| _no suite records found_ | | | | | |');
  } else {
    for (const r of records) {
      lines.push(
        `| ${r.suite} | ${r.runner} | ${r.totals.files} | ${r.totals.tests} | ${fmtSeconds(r.wallMs)} | ${fmtSeconds(r.workMs)} |`,
      );
    }
  }
  lines.push('');

  lines.push('#### Top 10 slowest files');
  lines.push('');
  lines.push('| # | Suite | File | Duration | Tests |');
  lines.push('|---|---|---|---|---|');
  const allFiles = records.flatMap((r) => r.files.map((f) => ({ ...f, suite: r.suite })));
  allFiles.sort((a, b) => b.durationMs - a.durationMs);
  allFiles.slice(0, 10).forEach((f, i) => {
    lines.push(
      `| ${i + 1} | ${f.suite} | \`${f.file}\` | ${fmtSeconds(f.durationMs)} | ${f.tests} |`,
    );
  });

  return {
    markdown: lines.join('\n') + '\n',
    warnings,
    exitCode: anyEnforcedBreach ? 1 : 0,
  };
}

export function summarize(args) {
  const recordsDir = readArgFlag(args, 'records');
  const jobsPath = readArgFlag(args, 'jobs');
  const budgetsPath = readArgFlag(args, 'budgets');
  const outPath = readArgFlag(args, 'out');
  if (!recordsDir || !jobsPath || !budgetsPath) {
    console.error(
      'usage: ci-timings.mjs summarize --records <dir> --jobs <jobs.json> --budgets <budgets.json> [--out <path>]',
    );
    process.exit(1);
  }

  // Artifacts are downloaded from a live run; a truncated upload or a stray
  // non-record .json in the directory must not take the whole summary down,
  // since this job's only output is a report nobody is gated on.
  const records = findJsonFilesRecursively(recordsDir).flatMap((f) => {
    try {
      const parsed = JSON.parse(readFileSync(f, 'utf8'));
      // Check the whole shape buildSummary dereferences, not just `suite` —
      // an object carrying `suite` but no `totals`/`files` parses fine and
      // then throws on `r.totals.files`, reddening the timings job for the
      // corrupt artifact this guard exists to tolerate.
      const usable =
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.suite === 'string' &&
        parsed.totals &&
        typeof parsed.totals === 'object' &&
        !Array.isArray(parsed.totals) &&
        typeof parsed.totals.files === 'number' &&
        typeof parsed.totals.tests === 'number' &&
        Array.isArray(parsed.files);
      if (!usable) {
        console.error(`ci-timings summarize: skipping malformed record ${f}`);
        return [];
      }
      return [parsed];
    } catch (e) {
      console.error(`ci-timings summarize: skipping unreadable record ${f}: ${e.message}`);
      return [];
    }
  });
  const jobsRaw = JSON.parse(readFileSync(jobsPath, 'utf8'));
  const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'));

  const { markdown, warnings, exitCode } = buildSummary({
    records,
    jobs: jobsRaw.jobs ?? jobsRaw,
    budgets,
  });

  if (outPath) {
    writeFileSync(outPath, markdown);
  } else {
    process.stdout.write(markdown);
  }
  for (const w of warnings) console.log(w);

  // `process.exitCode`, never `process.exit()`. On POSIX, stdout to a pipe
  // (which is what the Actions runner hands a step) is asynchronous, so
  // `process.exit()` can drop buffered writes — silently discarding the very
  // `::warning::` annotations the `--out` flag above exists to keep on the
  // step log. Same hazard `scripts/flake-report.mjs` documents.
  process.exitCode = exitCode;
}

// ---------------------------------------------------------------------------
// report — plain-text local summary for `yarn test:timings` (#441).
// ---------------------------------------------------------------------------
export function buildReportText(records) {
  const wallMs = records.length > 0 ? Math.max(...records.map((r) => r.wallMs)) : 0;
  const workMs = records.reduce((sum, r) => sum + r.workMs, 0);
  const allFiles = records.flatMap((r) => r.files.map((f) => ({ ...f, suite: r.suite })));
  allFiles.sort((a, b) => b.durationMs - a.durationMs);

  const lines = [
    `wall: ${fmtSeconds(wallMs)}  work: ${fmtSeconds(workMs)}`,
    '',
    'Top 10 slowest files:',
  ];
  allFiles.slice(0, 10).forEach((f, i) => {
    lines.push(`  ${i + 1}. ${f.file} (${f.suite}, ${fmtSeconds(f.durationMs)}, ${f.tests} tests)`);
  });
  return lines.join('\n') + '\n';
}

function report(args) {
  if (args.length === 0) {
    console.error('usage: ci-timings.mjs report <record.json>...');
    process.exit(1);
  }
  const records = args.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  process.stdout.write(buildReportText(records));
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'collect') return collect(rest);
  if (command === 'summarize') return summarize(rest);
  if (command === 'report') return report(rest);
  console.error('usage: ci-timings.mjs <collect|summarize|report> ...');
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
