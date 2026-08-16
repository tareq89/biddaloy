#!/usr/bin/env node
/**
 * [8.9.1]'s "route-level code splitting verified in a bundle report" AC,
 * automated rather than eyeballed once: a real production build (same
 * `vite.config.ts`, same `@tanstack/router-plugin` `autoCodeSplitting`),
 * asserting each feature route landed in its own chunk instead of all
 * getting inlined into one bundle. `yarn build:analyze` is the
 * human-readable companion to this — a treemap for when "is it split"
 * isn't enough and you need to see *how big* each piece is.
 *
 * A standalone script, not a Vitest spec: a real build is slow and
 * memory-heavy enough that running it inside the same worker pool as the
 * rest of the monorepo's frontend test suite crashed the whole run with
 * an out-of-memory error the first time this was tried (hundreds of
 * parallel test files plus a production build competing for one
 * process's heap). Same shape as `ui`'s `check:contrast`/`check:i18n`/
 * `check:api-types` — a dedicated CI step, not folded into `test:frontend`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = mkdtempSync(join(tmpdir(), 'client-admin-build-'));
// `npx` rather than a direct `node_modules/.bin/vite` path — resolves the
// locally installed `vite` regardless of where yarn's workspace hoisting
// happened to put it.
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// Every feature route file that should be its own chunk — kept in sync
// by hand with `src/routes/`, the same way the route tree itself is: a
// small, deliberate list rather than something derived from a glob,
// since the point is catching a route that *stopped* being split, not
// discovering routes automatically.
const EXPECTED_ROUTE_CHUNKS = ['settings', 'students', 'fees'];

try {
  execFileSync(npxCommand, ['vite', 'build', '--outDir', outDir, '--logLevel', 'silent'], {
    cwd: projectRoot,
    stdio: 'pipe',
  });

  const jsChunks = readdirSync(join(outDir, 'assets')).filter((fileName) => fileName.endsWith('.js'));

  const missing = EXPECTED_ROUTE_CHUNKS.filter(
    (routeName) => !jsChunks.some((fileName) => fileName.includes(routeName)),
  );

  if (missing.length > 0) {
    console.error(`✗ Missing a separate chunk for: ${missing.join(', ')}`);
    console.error(`  Chunks actually produced: ${jsChunks.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ Every feature route (${EXPECTED_ROUTE_CHUNKS.join(', ')}) has its own chunk.`);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
