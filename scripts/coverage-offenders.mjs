#!/usr/bin/env node
/**
 * Names the files dragging coverage under the thresholds (#153): vitest
 * with `perFile: false` fails the run naming only the metric, so this
 * prints every file below the global threshold values, worst first.
 *
 * Usage: node scripts/coverage-offenders.mjs [coverage/lcov.info]
 *
 * Prints nothing when nothing is under threshold (the honest output when
 * the step runs after a non-coverage failure, or when no coverage was
 * produced at all). The threshold mirrors the global block in
 * vitest.config.ts; the stricter per-directory tiers fail their own
 * named checks already.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseLcov } from './coverage-summary.mjs';

const THRESHOLD = 70; // global lines/branches/functions floor

const path = process.argv[2] ?? 'coverage/lcov.info';
if (!existsSync(path)) process.exit(0);

const { files } = parseLcov(readFileSync(path, 'utf8'));
const pct = (hit, found) => (found === 0 ? 100 : (hit / found) * 100);

const rows = [];
for (const [file, c] of files) {
  const lines = pct(c.LH, c.LF);
  const branches = pct(c.BRH, c.BRF);
  const functions = pct(c.FNH, c.FNF);
  const worst = Math.min(lines, branches, functions);
  if (worst < THRESHOLD) rows.push({ file, lines, branches, functions, worst });
}

if (rows.length > 0) {
  rows.sort((a, b) => a.worst - b.worst);
  console.log(`Files under the ${THRESHOLD}% global threshold, worst first:`);
  for (const r of rows) {
    console.log(
      `  ${r.file} — lines ${r.lines.toFixed(1)}%, ` +
        `branches ${r.branches.toFixed(1)}%, functions ${r.functions.toFixed(1)}%`,
    );
  }
}
