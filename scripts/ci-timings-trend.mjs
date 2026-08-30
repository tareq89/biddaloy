#!/usr/bin/env node
/**
 * [15.1] Weekly CI timing trend: trailing-60-run GitHub Actions history in,
 * a markdown table plus a JSON series out. Pure — no fs/network of its own
 * (`.github/workflows/ci-timings-trend.yml` fetches both inputs with `gh
 * api` and writes both outputs to the orphan `ci-timings` branch).
 *
 * Deliberately does **not** filter runs by `status=success` — see #436's
 * plan corrections: `main` has been red on every run since 2026-08-24
 * (Lighthouse), and a trend view that silently drops every red run would
 * report a stale "week ago" number forever while looking current. Failure
 * rate is one of the tracked series instead. `cancelled` runs are excluded
 * from that rate's denominator — a cancelled run (superseded PR push) says
 * nothing about whether the suite passes.
 *
 * Usage:
 *   node scripts/ci-timings-trend.mjs <runs.json> <jobs.jsonl> <out.md> <out.json>
 *
 * `runs.json`: `GET /repos/{o}/{r}/actions/workflows/ci.yml/runs?per_page=60`
 * response — `{ workflow_runs: [{ id, status, conclusion, ... }] }`.
 *
 * `jobs.jsonl`: one JSON object per line, one line per run:
 * `{"runId": <id>, "jobs": [{ name, started_at, completed_at, ... }]}`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 1;

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  // Nearest-rank method — simple, deterministic, no interpolation surprises
  // for the small (≤60) sample sizes this runs against.
  const rank = Math.min(
    sortedValues.length,
    Math.max(1, Math.ceil((p / 100) * sortedValues.length)),
  );
  return sortedValues[rank - 1];
}

function median(values) {
  return percentile(values, 50);
}

function fmtSeconds(ms) {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Pure: everything the trend needs, with no fs/process side effects, so
 * tests assert on the return value directly.
 */
export function buildTrend({ runs, jobsByRunId }) {
  const completed = runs.filter((r) => r.status === 'completed');
  const considered = completed.filter((r) => r.conclusion !== 'cancelled');
  const failed = considered.filter((r) => r.conclusion !== 'success');
  const failureRate = considered.length > 0 ? failed.length / considered.length : null;

  const wallValues = [];
  const jobDurationsByName = new Map();

  for (const run of considered) {
    const jobs = (jobsByRunId.get(run.id) ?? []).filter((j) => j.started_at && j.completed_at);
    if (jobs.length > 0) {
      const wallMs =
        Math.max(...jobs.map((j) => new Date(j.completed_at).getTime())) -
        Math.min(...jobs.map((j) => new Date(j.started_at).getTime()));
      wallValues.push(wallMs);
    }
    for (const j of jobs) {
      const durationMs = new Date(j.completed_at).getTime() - new Date(j.started_at).getTime();
      if (!jobDurationsByName.has(j.name)) jobDurationsByName.set(j.name, []);
      jobDurationsByName.get(j.name).push(durationMs);
    }
  }

  wallValues.sort((a, b) => a - b);
  const wall = {
    n: wallValues.length,
    medianMs: median(wallValues),
    p90Ms: percentile(wallValues, 90),
  };

  // A job absent from the current window (renamed, or newly added) simply
  // doesn't appear here — every run comes from a fresh `runs.json` fetch,
  // so there's no stale carried-over series to filter out.
  const jobs = [...jobDurationsByName.entries()]
    .map(([name, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { name, n: sorted.length, medianMs: median(sorted), p90Ms: percentile(sorted, 90) };
    })
    .sort((a, b) => (b.p90Ms ?? 0) - (a.p90Ms ?? 0));

  const json = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    window: { requestedRuns: runs.length, consideredRuns: considered.length },
    failureRate,
    wall,
    jobs,
  };

  const lines = [];
  lines.push('## CI timing trend');
  lines.push('');
  lines.push(
    `Over the trailing ${considered.length} run(s) (of ${runs.length} fetched, cancelled excluded from the failure rate below).`,
  );
  lines.push('');
  lines.push(
    `**Failure rate:** ${failureRate === null ? '—' : `${(failureRate * 100).toFixed(0)}% (${failed.length}/${considered.length})`}`,
  );
  lines.push('');
  lines.push('### Wall time');
  lines.push('');
  lines.push('| n | Median | p90 |');
  lines.push('|---:|---:|---:|');
  lines.push(`| ${wall.n} | ${fmtSeconds(wall.medianMs)} | ${fmtSeconds(wall.p90Ms)} |`);
  lines.push('');
  lines.push('### Per-job');
  lines.push('');
  lines.push('| Job | n | Median | p90 |');
  lines.push('|---|---:|---:|---:|');
  if (jobs.length === 0) {
    lines.push('| _no job data in this window_ | | | |');
  } else {
    for (const j of jobs) {
      lines.push(`| ${j.name} | ${j.n} | ${fmtSeconds(j.medianMs)} | ${fmtSeconds(j.p90Ms)} |`);
    }
  }

  return { markdown: lines.join('\n') + '\n', json };
}

function parseJobsJsonl(text) {
  const byRunId = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const { runId, jobs } = JSON.parse(line);
    byRunId.set(runId, jobs ?? []);
  }
  return byRunId;
}

function main() {
  const [runsPath, jobsPath, outMdPath, outJsonPath] = process.argv.slice(2);
  if (!runsPath || !jobsPath || !outMdPath || !outJsonPath) {
    console.error('usage: ci-timings-trend.mjs <runs.json> <jobs.jsonl> <out.md> <out.json>');
    process.exit(1);
  }

  const runsRaw = JSON.parse(readFileSync(runsPath, 'utf8'));
  const runs = runsRaw.workflow_runs ?? runsRaw;
  const jobsByRunId = parseJobsJsonl(readFileSync(jobsPath, 'utf8'));

  const { markdown, json } = buildTrend({ runs, jobsByRunId });

  writeFileSync(outMdPath, markdown);
  writeFileSync(outJsonPath, JSON.stringify(json, null, 2) + '\n');
  console.log(`Wrote ${outMdPath} and ${outJsonPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
