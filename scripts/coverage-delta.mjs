#!/usr/bin/env node
/**
 * Composes the frontend coverage PR comment (#153): totals, signed delta
 * per metric against the main baseline, and the 5 files with the largest
 * line-coverage drops — the part that makes a drop actionable rather than
 * a bare percentage.
 *
 * Usage: node scripts/coverage-delta.mjs <base-lcov> <pr-lcov> > comment.md
 *
 * A missing baseline file degrades to absolute numbers, not a failure.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseLcov } from './coverage-summary.mjs';

const [basePath, prPath] = process.argv.slice(2);
if (!prPath) {
  console.error('usage: coverage-delta.mjs <base-lcov> <pr-lcov>');
  process.exit(1);
}

const fmt = (v) => `${v.toFixed(2)}%`;
const signed = (d) => `${d >= 0 ? '+' : ''}${d.toFixed(2)}%`;
const pr = parseLcov(readFileSync(prPath, 'utf8'));
const metrics = ['lines', 'branches', 'functions', 'statements'];

console.log('### Frontend coverage');
console.log('');

if (!basePath || !existsSync(basePath)) {
  console.log('_No baseline from `main` yet — absolute numbers only._');
  console.log('');
  console.log('| Metric | Coverage |');
  console.log('|---|---|');
  for (const m of metrics) console.log(`| ${m} | ${fmt(pr.summary[m])} |`);
} else {
  const base = parseLcov(readFileSync(basePath, 'utf8'));
  console.log('| Metric | main | PR | Δ |');
  console.log('|---|---|---|---|');
  for (const m of metrics) {
    console.log(
      `| ${m} | ${fmt(base.summary[m])} | ${fmt(pr.summary[m])} | ${signed(pr.summary[m] - base.summary[m])} |`,
    );
  }

  // Per-file line-coverage drops, keyed by path, worst first.
  const drops = [];
  for (const [file, b] of base.files) {
    const p = pr.files.get(file);
    if (!p || b.LF === 0 || p.LF === 0) continue;
    const delta = (p.LH / p.LF - b.LH / b.LF) * 100;
    if (delta < -0.005)
      drops.push({ file, base: (b.LH / b.LF) * 100, pr: (p.LH / p.LF) * 100, delta });
  }
  drops.sort((a, b) => a.delta - b.delta);
  if (drops.length > 0) {
    console.log('');
    console.log('Largest per-file line-coverage drops:');
    console.log('');
    console.log('| File | main | PR | Δ |');
    console.log('|---|---|---|---|');
    for (const d of drops.slice(0, 5)) {
      console.log(`| \`${d.file}\` | ${fmt(d.base)} | ${fmt(d.pr)} | ${signed(d.delta)} |`);
    }
  }
}
