#!/usr/bin/env node
/**
 * Gate CI on `yarn audit`, but only on high/critical severity.
 *
 * Yarn 1's `--level` flag only filters what's printed — the process exit
 * code is a bitmask of every severity found (info=1, low=2, moderate=4,
 * high=8, critical=16), regardless of `--level`. A single low-severity
 * advisory would otherwise fail this job. This script re-implements the
 * filter correctly by reading `--json` output and only failing on
 * high/critical entries not present in ALLOWLIST below.
 *
 * Allowlisted advisories must carry a reason and a re-check date. The date
 * is enforced below, not just documentation — once it passes, this script
 * fails the job until someone re-reviews and picks a new date, so the
 * exception can't silently outlive its review window.
 */
const { spawnSync } = require('child_process');

// Prefer upgrading over allowlisting — an entry here is a standing
// exception, and the one this replaced (#1124334, brace-expansion) turned
// out to be avoidable: every consumer's own semver range already permitted
// a patched release, so refreshing the lockfile fixed it outright. Before
// adding an entry, check whether the vulnerable package is actually pinned
// or merely stale.
const ALLOWLIST = {
  1130734: {
    module: 'brace-expansion',
    reason:
      'DoS via unbounded intermediate arrays; no non-breaking fix exists. ' +
      'brace-expansion@1.1.18 (installed) is already the newest 1.x release — ' +
      'the advisory covers the whole 1.x line, not a stale patch, so unlike ' +
      "#1124334 this isn't fixable by refreshing the lockfile. Every 2.x+ " +
      'release switched to a dual ESM/CJS package (dist/commonjs/index.js) ' +
      "that breaks the plain `require('brace-expansion')(pattern)` call " +
      'style minimatch@3.x uses — confirmed by force-resolving to 5.0.9, ' +
      'which threw `brace_expansion_1.default is not a function` inside ' +
      "typeorm's own bundled minimatch@3 during entity glob-loading in " +
      'test:integration. The transitive pin (glob@7→minimatch@3→ ' +
      "brace-expansion@^1.1.7, via typeorm's and exceljs's dependency " +
      'trees) needs those packages to bump their own minimatch major ' +
      'before this can move — tracked, not silently dropped. Actual ' +
      'exposure here is low: brace-expansion only processes developer-' +
      'authored glob patterns (entity paths, build globs), never ' +
      'request-supplied input.',
    recheckBy: '2026-10-04',
  },
  1120654: {
    module: 'tmp',
    reason:
      'Path traversal via unsanitized prefix/postfix. Reached only through ' +
      '@lhci/cli (devDependency, #149) — tmp@^0.1.0 directly and ' +
      'tmp@^0.0.33 via inquirer>external-editor; neither range can reach ' +
      'the patched 0.2.6, so a lockfile refresh cannot fix it. lhci runs ' +
      'only in CI and locally against repo-controlled arguments — the ' +
      'prefix/postfix values are never attacker-supplied here. Re-check ' +
      'for an @lhci/cli release that bumps both chains.',
    recheckBy: '2026-10-24',
  },
  1139346: {
    module: 'extract-zip',
    reason:
      'Unvalidated symlink path traversal; no patched release exists ' +
      '(advisory lists <0.0.0 as patched). Reached only through ' +
      '@lhci/cli>lighthouse>puppeteer-core>@puppeteer/browsers ' +
      '(devDependency, #149), where extract-zip unpacks Chrome archives ' +
      "downloaded from Google's own distribution URLs — not " +
      'attacker-supplied zips. Re-check for an upstream fix release.',
    recheckBy: '2026-10-24',
  },
};

const today = new Date().toISOString().slice(0, 10);
const expired = Object.entries(ALLOWLIST).filter(([, e]) => e.recheckBy < today);
for (const [id, entry] of expired) {
  console.error(
    `Allowlist entry #${id} expired its re-check date (${entry.recheckBy}) — ` +
      're-review and update ALLOWLIST in scripts/ci-audit.js before this can pass again.',
  );
}

const result = spawnSync('yarn', ['audit', '--json'], {
  encoding: 'utf8',
  timeout: 5 * 60 * 1000,
});

if (result.error) {
  console.error(`Failed to run yarn audit: ${result.error.message}`);
  process.exit(1);
}
if (result.signal) {
  console.error(`yarn audit was terminated by signal ${result.signal} (possible timeout).`);
  process.exit(1);
}

const advisories = [];
for (const line of (result.stdout || '').split('\n')) {
  if (!line.trim()) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  if (entry.type === 'auditAdvisory') {
    advisories.push(entry.data.advisory);
  }
}

const unallowed = advisories.filter(
  (a) => (a.severity === 'high' || a.severity === 'critical') && !(a.id in ALLOWLIST),
);

const seen = new Set();
for (const a of advisories) {
  if (seen.has(a.id)) continue;
  seen.add(a.id);
  const status = a.id in ALLOWLIST ? 'ALLOWLISTED' : a.severity.toUpperCase();
  console.log(`[${status}] #${a.id} ${a.severity} — ${a.module_name}: ${a.title}`);
}

if (unallowed.length > 0) {
  console.error(
    `\n${new Set(unallowed.map((a) => a.id)).size} new high/critical advisory(ies) found. ` +
      'Fix them or add a reasoned, dated entry to ALLOWLIST in scripts/ci-audit.js.',
  );
  process.exit(1);
}

if (expired.length > 0) {
  process.exit(1);
}

console.log('\nNo unallowed high/critical advisories.');
