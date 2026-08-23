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
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

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

/**
 * [8.9.10]: one SPA now serves staff *and* guardians, so "extract a
 * separate guardian app later if this gets heavy" needs to be a number CI
 * enforces rather than an intention someone remembers. Gzip, because
 * that's what a browser actually downloads.
 *
 * Seeded just above the entry chunk measured when this landed: 215,380 B
 * gzipped (674,963 B raw), down from 237,675 B gzipped (745,575 B raw) on
 * the previous layout — moving `AppShell`, `TenantBar`, `NotificationBell`
 * and the search launcher out of `__root.tsx` and into the `_staff` layout
 * route took them out of the entry chunk. Raising this ceiling is allowed,
 * but deliberately, in a PR that says why — which is the entire point.
 *
 * Raised for [8.10.6]: 220,019 B gzipped (690,690 B raw) measured with
 * the new `/invoices` and `/invoices/$invoiceId` routes registered —
 * `routeTree.gen.ts`'s lazy-import wrapper for each new route lives in
 * the entry even though the route's own component is still code-split,
 * so every new route nudges this up a little on its own.
 */
const ENTRY_CHUNK_GZIP_CEILING_BYTES = 220_500;

/** The entry is whatever `index.html` loads as its module script — asked
 * of the build output rather than guessed from a filename pattern, which
 * changes with Vite's own naming. */
function readEntryChunkName(outDir) {
  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  const match = /<script[^>]+src="[^"]*?assets\/([^"]+\.js)"/.exec(html);
  return match?.[1] ?? null;
}

try {
  execFileSync(npxCommand, ['vite', 'build', '--outDir', outDir, '--logLevel', 'silent'], {
    cwd: projectRoot,
    stdio: 'pipe',
  });

  const jsChunks = readdirSync(join(outDir, 'assets')).filter((fileName) => fileName.endsWith('.js'));

  // Each route must claim its own, not-already-claimed chunk — matching
  // independently (route.some(chunk => chunk.includes(route))) would let a
  // single combined chunk like `settings-students-fees.js` satisfy every
  // route's check at once without actually proving any of them are split.
  const claimed = new Set();
  const missing = EXPECTED_ROUTE_CHUNKS.filter((routeName) => {
    const match = jsChunks.find((fileName) => !claimed.has(fileName) && fileName.includes(routeName));
    if (match === undefined) return true;
    claimed.add(match);
    return false;
  });

  if (missing.length > 0) {
    console.error(`✗ Missing a separate chunk for: ${missing.join(', ')}`);
    console.error(`  Chunks actually produced: ${jsChunks.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ Every feature route (${EXPECTED_ROUTE_CHUNKS.join(', ')}) has its own chunk.`);
  }

  const entryChunk = readEntryChunkName(outDir);
  if (entryChunk === null) {
    console.error('✗ Could not find the entry chunk referenced by index.html.');
    process.exitCode = 1;
  } else {
    const gzipBytes = gzipSync(readFileSync(join(outDir, 'assets', entryChunk))).length;
    const ceiling = ENTRY_CHUNK_GZIP_CEILING_BYTES;
    if (gzipBytes > ceiling) {
      console.error(
        `✗ Entry chunk ${entryChunk} is ${gzipBytes} B gzipped, over the ${ceiling} B ceiling.`,
      );
      console.error(
        '  Either trim it, split more of it per route, or raise ENTRY_CHUNK_GZIP_CEILING_BYTES on purpose.',
      );
      process.exitCode = 1;
    } else {
      console.log(`✓ Entry chunk ${entryChunk}: ${gzipBytes} B gzipped (ceiling ${ceiling} B).`);
    }
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
