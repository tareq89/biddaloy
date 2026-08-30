#!/usr/bin/env node
/**
 * lint-staged passes absolute file paths as argv by default, but that's a
 * config choice on lint-staged's side (its `relative: true` option switches
 * to cwd-relative paths) — normalizing every arg against repoRoot up front
 * means this script isn't quietly relying on that default holding forever.
 *
 * ESLint 9's flat config only looks for `eslint.config.*` in the current
 * working directory — it does not walk up from each linted file's own
 * directory the way `.eslintrc` resolution used to. Running plain `eslint
 * --fix <files>` from the repo root (where lint-staged itself runs) fails
 * outright: there is no root `eslint.config.mjs`, only one per package (ui,
 * client-admin).
 *
 * This groups the staged files lint-staged hands it by which package they
 * belong to and re-invokes `eslint --fix` with `cwd` set to that package, so
 * each file is linted against its own real config — the same one `yarn
 * workspace @biddaloy/<pkg> lint` uses.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ESLINT_PACKAGES = ['ui', 'client-admin'];
const repoRoot = path.resolve(import.meta.dirname, '..');

const filesByPackage = new Map();
for (const arg of process.argv.slice(2)) {
  const absPath = path.isAbsolute(arg) ? arg : path.resolve(repoRoot, arg);
  const relFromRoot = path.relative(repoRoot, absPath);
  const pkg = ESLINT_PACKAGES.find(
    (p) => relFromRoot === p || relFromRoot.startsWith(`${p}${path.sep}`),
  );
  if (!pkg) continue;
  const relFromPkg = path.relative(path.join(repoRoot, pkg), absPath);
  if (!filesByPackage.has(pkg)) filesByPackage.set(pkg, []);
  filesByPackage.get(pkg).push(relFromPkg);
}

// The direct binary path, not `npx eslint` — npx's own resolution check
// adds a few hundred ms per invocation, which matters when this script may
// run eslint multiple times (once per package with staged files) inside a
// pre-commit hook with a tight time budget.
const eslintBin = path.join(repoRoot, 'node_modules', '.bin', 'eslint');

let failed = false;
for (const [pkg, files] of filesByPackage) {
  const result = spawnSync(eslintBin, ['--fix', ...files], {
    cwd: path.join(repoRoot, pkg),
    stdio: 'inherit',
    // [15.6] Skips the type-checked rule set — see ui/eslint.config.mjs and
    // client-admin/eslint.config.mjs's own comments on the ESLINT_FAST
    // trade-off. `yarn workspace @biddaloy/<pkg> lint` (CI, `ci:local`)
    // never sets this, so those rules still gate every merge.
    env: { ...process.env, ESLINT_FAST: '1' },
  });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
