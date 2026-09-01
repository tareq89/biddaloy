#!/usr/bin/env node
/**
 * [15.6] Loudly fails when the locally running Node major doesn't match
 * what this repo is pinned to (`.nvmrc`), or when `.nvmrc` and any GitHub
 * workflow's pinned Node have drifted apart. Dependency-free ESM, same
 * house style as scripts/coverage-delta.mjs / scripts/bundle-delta.mjs.
 *
 * Workflows are ENUMERATED from `.github/workflows/`, never listed by
 * name. There were two at the time #441 was planned and four by the time
 * it was implemented (`nightly-e2e.yml` from #440, `ci-timings-trend.yml`
 * from #436), and a hardcoded pair would have silently ignored both — a
 * drift checker with a stale list of things to check is worse than none,
 * because it reports OK.
 *
 * Production runs a *different* major (`Dockerfile`'s `node:26-alpine`) —
 * that three-way split is unresolved, not decided (see README's
 * Prerequisites section and #441's "Needs human decision" note), not
 * something this script fails on. It's only reported here, as a note,
 * for visibility.
 *
 * Usage:
 *   node scripts/check-node-version.mjs [--no-runtime-check]
 *
 *   --no-runtime-check   Only check that .nvmrc / ci.yml / the nightly
 *                        workflow agree with each other; skip comparing
 *                        the running process's own Node version. Useful in
 *                        CI, where actions/setup-node has just installed
 *                        the pinned version and the runtime half of this
 *                        check would be a tautology — the drift-between-
 *                        config-files half is what CI should actually be
 *                        enforcing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Pure. `.nvmrc` content -> major version string, e.g. "24\n" -> "24". */
export function parseNvmrc(text) {
  const major = text.trim().replace(/^v/, '').split('.')[0];
  if (!/^\d+$/.test(major)) {
    throw new Error(`.nvmrc does not start with a plain major version: ${JSON.stringify(text)}`);
  }
  return major;
}

/**
 * Pure. Every literal Node major a workflow pins, via either
 * `NODE_VERSION: "24"` or `node-version: "24"`. Returns a de-duplicated
 * list, or `[]` for a workflow that pins none.
 *
 * Indirections like `node-version: ${{ env.NODE_VERSION }}` are skipped on
 * purpose: they are not a second source of truth, they resolve to the
 * workflow's own env, which this already reads.
 */
export function extractWorkflowNodeMajors(workflowYmlText) {
  const majors = [];
  const re = /(?:NODE_VERSION|node-version)\s*:\s*["']?(\d+)/g;
  let m;
  while ((m = re.exec(workflowYmlText)) !== null) majors.push(m[1]);
  return [...new Set(majors)];
}

/** Pure. Extracts Dockerfile's `FROM node:26-alpine` major, for the note. */
export function extractDockerNodeMajor(dockerfileText) {
  const m = dockerfileText.match(/FROM node:(\d+)-/);
  return m ? m[1] : null;
}

/**
 * Pure: given already-extracted majors, decide pass/fail and build the
 * problem/note lists. No fs, no `process.version` — the reason this is
 * split out of `main()` is exactly so a unit spec can drive it with
 * injected inputs instead of asserting against whatever Node happens to be
 * running the test (not guaranteed to be 24 — see this script's own
 * spec file header).
 */
export function evaluate({ requiredMajor, workflows, dockerMajor, runningMajor, checkRuntime }) {
  const problems = [];

  const pinning = workflows.filter((w) => w.majors.length > 0);
  if (pinning.length === 0) {
    problems.push(
      'no workflow in .github/workflows/ pins a Node version — either the ' +
        'directory moved or the extractor stopped matching. Refusing to ' +
        'report OK on a check that examined nothing.',
    );
  }

  for (const { file, majors } of pinning) {
    for (const major of majors) {
      if (major !== requiredMajor) {
        problems.push(
          `.nvmrc says Node ${requiredMajor}, but ${file} pins Node "${major}" — ` +
            'they must match. Fix .nvmrc or the workflow, whichever is stale.',
        );
      }
    }
  }

  if (checkRuntime && runningMajor !== requiredMajor) {
    problems.push(
      `you're running Node ${runningMajor}, but this repo is pinned to Node ${requiredMajor} ` +
        `(.nvmrc). Fix: nvm install ${requiredMajor} && nvm use`,
    );
  }

  const notes = [];
  if (dockerMajor !== null && dockerMajor !== requiredMajor) {
    notes.push(
      `production (Dockerfile) runs Node ${dockerMajor}, a different major than the Node ` +
        `${requiredMajor} this repo tests against locally and in CI — a known, accepted gap, ` +
        "see README's Prerequisites section.",
    );
  }

  return { ok: problems.length === 0, problems, notes };
}

function main() {
  const checkRuntime = !process.argv.includes('--no-runtime-check');

  const nvmrcPath = resolve(repoRoot, '.nvmrc');
  if (!existsSync(nvmrcPath)) {
    console.error('check-node-version: .nvmrc is missing. Fix: echo 24 > .nvmrc');
    process.exit(1);
  }

  const requiredMajor = parseNvmrc(readFileSync(nvmrcPath, 'utf8'));
  const workflowDir = resolve(repoRoot, '.github/workflows');
  const workflows = (existsSync(workflowDir) ? readdirSync(workflowDir) : [])
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((file) => ({
      file,
      majors: extractWorkflowNodeMajors(readFileSync(resolve(workflowDir, file), 'utf8')),
    }));
  const dockerfilePath = resolve(repoRoot, 'Dockerfile');
  const dockerMajor = existsSync(dockerfilePath)
    ? extractDockerNodeMajor(readFileSync(dockerfilePath, 'utf8'))
    : null;
  const runningMajor = process.versions.node.split('.')[0];

  const { ok, problems, notes } = evaluate({
    requiredMajor,
    workflows,
    dockerMajor,
    runningMajor,
    checkRuntime,
  });

  for (const note of notes) console.error(`check-node-version: note: ${note}`);

  if (!ok) {
    console.error('check-node-version: FAILED');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  // Name every file actually checked, so an OK line is auditable — if a
  // workflow is missing from this list, the check did not look at it.
  const checked = workflows
    .filter((w) => w.majors.length > 0)
    .map((w) => w.file)
    .join(', ');
  console.log(
    `check-node-version: OK — Node ${requiredMajor}, consistent across .nvmrc and ${checked}` +
      `${checkRuntime ? ', and the running process' : ' (runtime check skipped)'}.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
