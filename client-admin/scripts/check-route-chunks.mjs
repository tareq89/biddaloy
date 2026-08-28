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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const EXPECTED_ROUTE_CHUNKS = [
  'settings',
  'students',
  'fees',
  'classes',
  'guardians',
  // The [8.11.5] route's own chunk is named generically (`index-*.js`,
  // like every other `index.tsx` route entry); what carries the route's
  // name is its i18n namespace chunk, `feeStructures-*.js` — one per
  // locale, loaded only when the route is. That's the same thing
  // 'guardians'/'classes'/'fees' above actually match.
  'feeStructures',
  // [8.11.8]'s /staff and /staff/$userId routes — like the routes above,
  // what carries the name is the i18n namespace chunk (`staff-*.js`).
  'staff',
  // [8.11.9]'s /communications/send and /communications/reminders routes —
  // the i18n namespace chunk (`communications-*.js`) carries the name.
  'communications',
  // [8.11.10]'s /audit-logs route — same as every entry above, what
  // carries the name is its i18n namespace chunk, `auditLogs-*.js`.
  'auditLogs',
];

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
 *
 * Raised for [8.11.2]: 220,588 B gzipped measured with `/classes` and
 * `/classes/$classId` registered — 88 B over the previous ceiling. Same
 * cause as [8.10.6] above, not a regression in what gets split: both
 * classes routes do get their own chunks (`classes-*.js`, `_classId-*.js`,
 * now asserted by `EXPECTED_ROUTE_CHUNKS`), and only `routeTree.gen.ts`'s
 * per-route lazy-import wrappers land in the entry. Two new routes buys
 * ~44 B each, so this raise is the cost of registering them at all.
 *
 * Raised for [8.11.4]: 221,079 B gzipped measured with `/guardians` and
 * `/guardians/$guardianId` registered — 79 B over the previous ceiling.
 * Same cause again, not a regression: both guardians routes do get their
 * own chunks (`guardians-*.js`, `_guardianId-*.js`, now asserted by
 * `EXPECTED_ROUTE_CHUNKS`), and only `routeTree.gen.ts`'s per-route
 * lazy-import wrappers land in the entry.
 */
/**
 * Raised in [8.11.5]: 221,837 B gzipped measured with the new
 * `/fee-structures` route registered — 337 B over the previous ceiling.
 * Same cause as every bump above, not a regression: the route's own
 * component still code-splits into its own chunk (verified by
 * `EXPECTED_ROUTE_CHUNKS`), only `routeTree.gen.ts`'s per-route
 * lazy-import wrapper lands in the entry.
 */
/**
 * Raised for [8.11.8]: 222,808 B gzipped measured with the new `/staff`
 * and `/staff/$userId` routes registered — 508 B over the previous
 * ceiling. Same cause as every bump above, not a regression: both staff
 * routes get their own chunks (asserted by `EXPECTED_ROUTE_CHUNKS`), and
 * only `routeTree.gen.ts`'s per-route lazy-import wrappers land in the
 * entry.
 */
/**
 * Raised for [8.11.9]: 223,524 B gzipped measured with the new
 * `/communications/send` and `/communications/reminders` routes
 * registered — 224 B over the previous ceiling. Same cause as every bump
 * above, not a regression: both communications routes get their own
 * chunks (asserted by `EXPECTED_ROUTE_CHUNKS`), and only
 * `routeTree.gen.ts`'s per-route lazy-import wrappers land in the entry.
 */
/**
 * Raised again for [8.11.9]'s final slice: 223,738 B gzipped measured
 * with the `/communications/batches` and `/communications/batches/$batchId`
 * routes registered plus the third Communications nav item in
 * `_staff.tsx` — 38 B over the previous ceiling. Same cause as every
 * bump above, not a regression: both batch routes land in the existing
 * `communications` chunk, and only `routeTree.gen.ts`'s per-route
 * lazy-import wrappers (and the nav entry) land in the entry.
 */
/**
 * Raised for [8.11.10]: 224,783 B gzipped with the new `/audit-logs`
 * route registered, its nav item in `_staff.tsx`, and the tenant-wide
 * list hook added to `ui/src/hooks/audit-logs.ts`.
 *
 * **Measure this on Node 24, the version CI runs.** Node 22 builds the
 * same tree ~700 B smaller (224,059 B for this exact commit), so a number
 * taken on Node 22 sets the ceiling below what CI will enforce and the
 * check passes locally while failing in CI. That is what happened here:
 * the first attempt at this bump read 224,059 on Node 22 and set 224,200,
 * which CI rejected at 224,783.
 *
 * The route's own component, its diff panel and its `auditLogs` i18n
 * namespace all code-split into their own chunks — verified by grepping
 * the built entry for route-only strings (`ReminderBatchPreview`,
 * `__all__`, `Audit trail`): none appear. What does land in the entry is
 * the per-route `routeTree.gen.ts` wrapper, the nav entry, and the new
 * exports in `ui/src/hooks/audit-logs.ts` — that module is already pulled
 * into the entry by `useAuditLogsByEntity`/`useLoginAuditLogs`, so adding
 * to it grows the entry rather than a route chunk. Measured against base
 * `a12b6a5` on Node 24 (223,465 B), this issue's total cost is 1,318 B.
 */
/**
 * Raised for [5.2]: 224,902 B gzipped measured on Node 24 with the family
 * portal's landing page — 2 B over the previous ceiling, and 119 B over
 * the 224,783 B base this ceiling was last set from (`main` has only moved
 * in `.github/workflows/ci.yml` since, so that base still stands).
 *
 * The smallest bump in this list, and worth saying why a whole new page
 * costs so little: almost none of it is in the entry. Verified the same
 * way [8.11.10] above was — grepping the built entry for strings that
 * exist only in the new code. `bottom-nav` (the component's `data-slot`),
 * the hero's "Total outstanding" and even the nav icons' SVG path data are
 * all absent from the entry and present in exactly one route chunk:
 * `BottomNav`, `Card`, the icons and the page itself all code-split with
 * `/portal`.
 *
 * What does land in the entry is `routeTree.gen.ts`'s bookkeeping and the
 * new `/students/mine` hook — `ui/src/hooks/students.ts` is already pulled
 * into the entry by `useStudents`, so adding exports to it grows the entry
 * rather than a route chunk, exactly as [8.11.10]'s audit-logs hook did.
 */
/**
 * 278,492 B gzipped measured on epic 8.12, against 225,734 B before it.
 *
 * Two things grew the entry, and only one of them was worth paying for.
 *
 * **Dexie (~34 KB) was not.** The offline store is useless until the user
 * loses their connection, so a static import made every first visit pay
 * 15% of the budget for a feature most sessions never reach. It is now
 * behind a dynamic `import()` in `ui/src/api/offline-db.ts` and out of
 * this number entirely.
 *
 * **Sentry's tracing SDK (~50 KB) was.** [8.12.7]'s acceptance criterion
 * is that LCP, CLS and INP report *from real users*, and there is no way
 * to measure real users without shipping the code that measures them. It
 * cannot be deferred the way Dexie can: browser tracing has to be
 * registered before the page finishes loading or the pageload
 * transaction — the one carrying LCP — never happens.
 *
 * So this ceiling is a deliberate, and uncomfortable, trade: a 23%
 * larger entry chunk on an app whose target is a mid-range Android on 3G,
 * in exchange for knowing what that device actually experiences. The
 * honest way to claw it back is to load the tracing SDK only for the
 * ~10% of sessions `tracesSampleRate` actually samples, deciding
 * sampling client-side before the import. That is a real piece of work,
 * not a tweak, and it is not in this epic.
 *
 * `workbox-window` is deliberately *not* in this number:
 * `src/pwa/register.ts` reaches `virtual:pwa-register` through a dynamic
 * `import()`, so its ~4 KB splits into its own chunk instead.
 *
 * ~1.5 KB of headroom, per the note on the previous bump: a ceiling set
 * flush against the current measurement fails the next unrelated change
 * and reads as "your PR broke the budget" to whoever trips it.
 */
const ENTRY_CHUNK_GZIP_CEILING_BYTES = 280_000;

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

  const jsChunks = readdirSync(join(outDir, 'assets')).filter((fileName) =>
    fileName.endsWith('.js'),
  );

  // Each route must claim its own, not-already-claimed chunk — matching
  // independently (route.some(chunk => chunk.includes(route))) would let a
  // single combined chunk like `settings-students-fees.js` satisfy every
  // route's check at once without actually proving any of them are split.
  const claimed = new Set();
  const missing = EXPECTED_ROUTE_CHUNKS.filter((routeName) => {
    const match = jsChunks.find(
      (fileName) => !claimed.has(fileName) && fileName.includes(routeName),
    );
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

    // Machine-readable report for the bundle-delta PR comment (#150):
    // every JS chunk's gzip size, plus which one is the entry and the
    // ceiling it is held to. Written to dist/ (gitignored) so CI can
    // upload it as an artifact.
    const report = {
      entry: { file: entryChunk, gzipBytes, ceilingBytes: ceiling },
      chunks: jsChunks
        .map((fileName) => ({
          file: fileName,
          gzipBytes: gzipSync(readFileSync(join(outDir, 'assets', fileName))).length,
        }))
        .sort((a, b) => b.gzipBytes - a.gzipBytes),
      pass: process.exitCode !== 1,
    };
    mkdirSync(join(projectRoot, 'dist'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'dist', 'route-chunks-report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log('✓ Wrote dist/route-chunks-report.json');
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
