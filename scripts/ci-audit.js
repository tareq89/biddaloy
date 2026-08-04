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
const { spawnSync } = require("child_process");

// Empty on purpose. Prefer upgrading over allowlisting — an entry here is a
// standing exception, and the one this replaced (#1124334, brace-expansion)
// turned out to be avoidable: every consumer's own semver range already
// permitted a patched release, so refreshing the lockfile fixed it outright.
// Before adding an entry, check whether the vulnerable package is actually
// pinned or merely stale.
const ALLOWLIST = {};

const today = new Date().toISOString().slice(0, 10);
const expired = Object.entries(ALLOWLIST).filter(([, e]) => e.recheckBy < today);
for (const [id, entry] of expired) {
  console.error(
    `Allowlist entry #${id} expired its re-check date (${entry.recheckBy}) — ` +
      "re-review and update ALLOWLIST in scripts/ci-audit.js before this can pass again.",
  );
}

const result = spawnSync("yarn", ["audit", "--json"], {
  encoding: "utf8",
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
for (const line of (result.stdout || "").split("\n")) {
  if (!line.trim()) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  if (entry.type === "auditAdvisory") {
    advisories.push(entry.data.advisory);
  }
}

const unallowed = advisories.filter(
  (a) =>
    (a.severity === "high" || a.severity === "critical") &&
    !(a.id in ALLOWLIST),
);

const seen = new Set();
for (const a of advisories) {
  if (seen.has(a.id)) continue;
  seen.add(a.id);
  const status = a.id in ALLOWLIST ? "ALLOWLISTED" : a.severity.toUpperCase();
  console.log(`[${status}] #${a.id} ${a.severity} — ${a.module_name}: ${a.title}`);
}

if (unallowed.length > 0) {
  console.error(
    `\n${new Set(unallowed.map((a) => a.id)).size} new high/critical advisory(ies) found. ` +
      "Fix them or add a reasoned, dated entry to ALLOWLIST in scripts/ci-audit.js.",
  );
  process.exit(1);
}

if (expired.length > 0) {
  process.exit(1);
}

console.log("\nNo unallowed high/critical advisories.");
