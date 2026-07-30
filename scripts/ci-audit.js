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
 * Allowlisted advisories must carry a reason and a re-check date so they
 * don't rot into a silent, permanent bypass.
 */
const { spawnSync } = require("child_process");

const ALLOWLIST = {
  // brace-expansion ReDoS, patched >=5.0.8. Reachable only through
  // exceljs -> archiver's own zip-pattern glob matching (build-time,
  // developer-controlled patterns), not attacker-controlled input.
  // typeorm also bundles an old copy of the same chain to load
  // entity/migration files at boot via its own hardcoded glob patterns —
  // same reasoning. Forcing a newer brace-expansion via `resolutions`
  // breaks typeorm's bundled `minimatch@3`, which expects the old
  // brace-expansion CJS export shape (verified: entity loading fails at
  // boot). No compatible upstream fix exists for minimatch@3 today.
  // Re-check: 2026-10-30, or sooner if exceljs/typeorm bump their glob
  // dependency chain.
  1124334: "exceljs/typeorm bundle an incompatible old minimatch; see comment above",
};

const result = spawnSync("yarn", ["audit", "--json"], { encoding: "utf8" });

const advisories = [];
for (const line of result.stdout.split("\n")) {
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

console.log("\nNo unallowed high/critical advisories.");
