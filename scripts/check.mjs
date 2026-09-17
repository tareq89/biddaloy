#!/usr/bin/env node
/**
 * [18.4.2] `yarn check` — runs typecheck, lint and affected tests
 * concurrently, prints a one-line summary per task as it finishes, then
 * the buffered stdout/stderr of only the tasks that failed. This is the
 * one command the `.husky/pre-push` hook runs (with `--affected`) so a
 * push never lands red CI.
 *
 * Usage:
 *   node scripts/check.mjs [--affected]
 *
 *   --affected  Scope lint to files changed since origin/main instead of
 *               the whole repo. `tests` is always affected-only (it
 *               shells out to scripts/test-affected.mjs, which is itself
 *               affected-based).
 */
import { spawn, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Runs one shell command, buffering its combined stdout+stderr instead of
 * inheriting it, so passing tasks stay silent and only a failing task's
 * output gets printed.
 *
 * @param {string} name
 * @param {string} command
 * @param {string[]} args
 * @returns {{ name: string, ok: boolean, seconds: number, output: string, startedAt: number }}
 */
export function runOne(name, command, args) {
  const startedAt = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd: repoRoot, shell: process.platform === 'win32' });
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', (code) => {
      resolvePromise({
        name,
        ok: code === 0,
        seconds: (Date.now() - startedAt) / 1000,
        output,
        startedAt,
      });
    });
  });
}

/**
 * Runs every task concurrently and prints the pass/fail summary + failed
 * output. Exported so scripts/check.spec.mjs can drive it directly
 * instead of spawning a CLI subprocess per test.
 *
 * @param {{ name: string, command: string, args: string[] }[]} tasks
 * @param {{ log?: (line: string) => void }} [opts]
 * @returns {Promise<boolean>} true if every task passed
 */
export async function runTasks(tasks, opts = {}) {
  const log = opts.log ?? ((line) => console.log(line));

  const results = await Promise.all(
    tasks.map((task) => runOne(task.name, task.command, task.args)),
  );

  for (const result of results) {
    const icon = result.ok ? '✓' : '✗';
    log(`${icon} ${result.name} ${result.seconds.toFixed(1)}s`);
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of failed) {
    log(`\n--- ${result.name} output ---`);
    log(result.output);
  }

  return failed.length === 0;
}

// Committed diff against `base`, PLUS working-tree changes (staged and
// unstaged) and untracked files — consistent with `tests`' own affected
// detection (scripts/test-affected.mjs shells out to `vitest --changed`,
// which covers uncommitted work too). A committed-only diff would miss
// exactly the files someone is mid-edit on, which is the normal state
// while `.husky/pre-push` runs this.
function changedFiles(base) {
  const pathspec = ['--', '*.ts', '*.tsx', '*.mjs'];
  const committed = execFileSync('git', ['diff', '--name-only', base, ...pathspec], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const workingTree = execFileSync('git', ['diff', '--name-only', 'HEAD', ...pathspec], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', ...pathspec],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const files = new Set(
    [committed, workingTree, untracked].flatMap((out) => out.split('\n').filter(Boolean)),
  );
  return [...files];
}

// Packages with their own flat eslint.config.mjs — server's "lint" script
// is `tsc -b` (stricter typecheck, not eslint), so it isn't part of this.
const ESLINT_PACKAGES = ['ui', 'client-admin'];

/**
 * Builds the shell command for the `lint` task.
 *
 * Full run: each package's own `lint` script (ui/client-admin run eslint
 * over their whole tree; server's `lint` is its stricter tsc pass).
 * `--affected`: eslint scoped to the changed `*.ts`/`*.tsx`/`*.mjs` files,
 * grouped by owning package so each gets its own flat config.
 */
function buildLintCommand(affected) {
  if (!affected) {
    const perPackage = ['server', ...ESLINT_PACKAGES].map(
      (pkg) => `yarn workspace @biddaloy/${pkg} lint`,
    );
    return { command: 'sh', args: ['-c', perPackage.join(' && ')] };
  }

  const files = changedFiles('origin/main');
  const byPackage = ESLINT_PACKAGES.map((pkg) => ({
    pkg,
    files: files.filter((file) => file.startsWith(`${pkg}/`)),
  })).filter((entry) => entry.files.length > 0);

  const commands = byPackage.map(
    ({ pkg, files: pkgFiles }) =>
      `npx eslint --config ${pkg}/eslint.config.mjs ${pkgFiles.map((file) => `'${file.replace(/'/g, `'\\''`)}'`).join(' ')}`,
  );

  // server has no flat eslint.config.mjs — its "lint" is a stricter tsc -b
  // pass (tsconfig.lint.json) that isn't file-scopable, so any affected
  // server/ change re-runs it in full rather than being silently skipped.
  if (files.some((file) => file.startsWith('server/'))) {
    commands.push('yarn workspace @biddaloy/server lint');
  }

  if (commands.length === 0) {
    return { command: 'sh', args: ['-c', 'echo "no affected lint files"'] };
  }

  return { command: 'sh', args: ['-c', commands.join(' && ')] };
}

async function main() {
  const affected = process.argv.includes('--affected');
  const lint = buildLintCommand(affected);

  const tasks = [
    { name: 'typecheck', command: 'yarn', args: ['typecheck'] },
    { name: 'lint', command: lint.command, args: lint.args },
    { name: 'tests', command: 'node', args: ['scripts/test-affected.mjs'] },
  ];

  const ok = await runTasks(tasks);
  process.exit(ok ? 0 : 1);
}

// pathToFileURL (not a manual `file://` template) so this comparison
// works on Windows, where process.argv[1] is a filesystem path (drive
// letter, backslashes) that a plain string template doesn't URL-encode.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
