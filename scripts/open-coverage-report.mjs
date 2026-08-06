#!/usr/bin/env node
/**
 * Opens the frontend coverage HTML report in the default browser — the
 * "opens a local HTML report" half of `yarn coverage`. Deliberately its
 * own script, not folded into the `vitest run --coverage` invocation
 * itself: CI runs that same coverage command too (for the lcov artifact),
 * and a browser-opening call there would hang a headless runner.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import open from 'open';

const reportPath = resolve(import.meta.dirname, '..', 'coverage', 'index.html');

if (!existsSync(reportPath)) {
  console.error(`No coverage report found at ${reportPath} — did the coverage run fail?`);
  process.exit(1);
}

await open(reportPath);
