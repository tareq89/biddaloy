#!/usr/bin/env node
/**
 * Sums an lcov.info file into overall percentages (#153).
 *
 * Usage: node scripts/coverage-summary.mjs <lcov.info>
 *
 * lcov records are plain line sums: LF/LH (lines found/hit),
 * BRF/BRH (branches), FNF/FNH (functions). Statements are what vitest's
 * lcov reporter calls lines, so "statements" mirrors "lines" here.
 */
import { readFileSync } from 'node:fs';

export function parseLcov(text) {
  const totals = { LF: 0, LH: 0, BRF: 0, BRH: 0, FNF: 0, FNH: 0 };
  const files = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      current = { LF: 0, LH: 0, BRF: 0, BRH: 0, FNF: 0, FNH: 0 };
      files.set(line.slice(3).trim(), current);
      continue;
    }
    const m = /^(LF|LH|BRF|BRH|FNF|FNH):(\d+)$/.exec(line.trim());
    if (m) {
      totals[m[1]] += Number(m[2]);
      if (current) current[m[1]] += Number(m[2]);
    }
  }
  const pct = (hit, found) => (found === 0 ? 100 : (hit / found) * 100);
  return {
    summary: {
      lines: pct(totals.LH, totals.LF),
      branches: pct(totals.BRH, totals.BRF),
      functions: pct(totals.FNH, totals.FNF),
      statements: pct(totals.LH, totals.LF),
    },
    files,
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: coverage-summary.mjs <lcov.info>');
    process.exit(1);
  }
  const { summary } = parseLcov(readFileSync(path, 'utf8'));
  console.log(
    JSON.stringify(
      Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Number(v.toFixed(2))])),
      null,
      2,
    ),
  );
}
