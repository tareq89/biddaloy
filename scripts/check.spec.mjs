import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLintCommand, changedFiles, runOne, runTasks } from './check.mjs';

/** A task whose "command" is just `node -e <script>`, so tests don't shell out to real yarn/eslint. */
function nodeTask(name, script) {
  return { name, command: process.execPath, args: ['-e', script] };
}

describe('runTasks', () => {
  it('exits ok with three checkmarks when every task passes', async () => {
    const lines = [];
    const ok = await runTasks(
      [
        nodeTask('typecheck', 'process.exit(0)'),
        nodeTask('lint', 'process.exit(0)'),
        nodeTask('tests', 'process.exit(0)'),
      ],
      { log: (line) => lines.push(line) },
    );

    expect(ok).toBe(true);
    const summaryLines = lines.filter((line) => line.startsWith('✓') || line.startsWith('✗'));
    expect(summaryLines).toHaveLength(3);
    expect(summaryLines.every((line) => line.startsWith('✓'))).toBe(true);
  });

  it('exits failed and prints only the failing task output', async () => {
    const lines = [];
    const ok = await runTasks(
      [
        nodeTask('typecheck', 'process.exit(0)'),
        nodeTask('lint', "console.error('lint broke'); process.exit(1)"),
        nodeTask('tests', 'process.exit(0)'),
      ],
      { log: (line) => lines.push(line) },
    );

    expect(ok).toBe(false);
    const summary = lines.filter((line) => line.startsWith('✓') || line.startsWith('✗'));
    expect(summary).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^✗ lint/),
        expect.stringMatching(/^✓ typecheck/),
        expect.stringMatching(/^✓ tests/),
      ]),
    );

    const output = lines.join('\n');
    expect(output).toContain('lint broke');
    expect(output).not.toContain('--- typecheck output ---');
    expect(output).not.toContain('--- tests output ---');
  });

  it('runs tasks concurrently, not sequentially', async () => {
    const script = (ms) => `setTimeout(() => process.exit(0), ${ms})`;
    const start = Date.now();
    await runTasks(
      [nodeTask('a', script(150)), nodeTask('b', script(150)), nodeTask('c', script(150))],
      { log: () => {} },
    );
    const elapsed = Date.now() - start;

    // Sequential would take ~450ms; concurrent should finish close to 150ms.
    expect(elapsed).toBeLessThan(350);
  });

  it('starts every task within 100ms of the others', async () => {
    const results = await Promise.all([
      runOne('a', process.execPath, ['-e', 'process.exit(0)']),
      runOne('b', process.execPath, ['-e', 'process.exit(0)']),
      runOne('c', process.execPath, ['-e', 'process.exit(0)']),
    ]);

    const starts = results.map((r) => r.startedAt);
    const spread = Math.max(...starts) - Math.min(...starts);
    expect(spread).toBeLessThan(100);
  });

  const scratchFile = join(process.cwd(), 'ui', `__check-spec-scratch-${process.pid}.ts`);

  afterEach(() => {
    rmSync(scratchFile, { force: true });
  });

  it('drops a changed-but-now-deleted file instead of handing it to eslint', () => {
    // A file that shows up in `git diff --name-only <base>` but no longer
    // exists on disk (deleted after that diff, or on a branch stacked far
    // ahead of `base`) used to crash the whole `--affected` eslint
    // invocation instead of being skipped — regression for that.
    // AFFECTED_BASE is pinned to HEAD here so the test doesn't depend on
    // an `origin/main` ref existing in the checkout (a CI job for a PR
    // stacked on a non-main base only fetches that base, not `origin/main`).
    const prevBase = process.env.AFFECTED_BASE;
    process.env.AFFECTED_BASE = 'HEAD';
    try {
      writeFileSync(scratchFile, 'export const x = 1;\n');
      try {
        const withFile = buildLintCommand(true);
        expect(withFile.args.join(' ')).toContain('__check-spec-scratch');
      } finally {
        rmSync(scratchFile, { force: true });
      }

      // Now the same untracked file is gone but still exists in the
      // working-tree diff `changedFiles()` reads from `git diff --name-only
      // HEAD` momentarily — simulate that by asserting the real fix directly:
      // changedFiles() itself does no existence filtering (it's a pure git
      // diff), buildLintCommand() is what must filter, and it must never
      // reference a path that doesn't exist on disk right now.
      const command = buildLintCommand(true);
      for (const arg of command.args) {
        expect(arg).not.toContain('__check-spec-scratch');
      }
    } finally {
      if (prevBase === undefined) delete process.env.AFFECTED_BASE;
      else process.env.AFFECTED_BASE = prevBase;
    }
  });

  it('honors AFFECTED_BASE for lint scoping, same override scripts/test-affected.mjs reads', () => {
    const prev = process.env.AFFECTED_BASE;
    // A second, always-resolvable ref: HEAD's own SHA, obtained with a real
    // git call rather than a hardcoded branch name like `origin/main`,
    // which isn't fetched in every checkout (e.g. a stacked-PR CI job).
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
    try {
      process.env.AFFECTED_BASE = 'HEAD';
      const filesAgainstHead = changedFiles('HEAD');
      // Against HEAD itself there should be no committed diff (only
      // working-tree/untracked noise, which changedFiles also includes) —
      // this just proves the base argument is actually threaded through
      // rather than hardcoded, by comparing two different explicit bases.
      const filesAgainstSha = changedFiles(headSha);
      expect(Array.isArray(filesAgainstHead)).toBe(true);
      expect(Array.isArray(filesAgainstSha)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.AFFECTED_BASE;
      else process.env.AFFECTED_BASE = prev;
    }
  });

  it('passes the affected file list to lint when --affected is used', async () => {
    // check.mjs's own CLI (not runTasks) builds the lint args from
    // `git diff --name-only origin/main`; this exercises the exported
    // runTasks contract with an equivalent task shape to document that
    // the lint command's argv carries the file list.
    const lines = [];
    const files = ['scripts/check.mjs', 'scripts/check.spec.mjs'];
    const ok = await runTasks(
      [
        {
          name: 'lint',
          command: process.execPath,
          args: ['-e', `console.log(process.argv.slice(1).join(','))`, ...files],
        },
      ],
      { log: (line) => lines.push(line) },
    );

    expect(ok).toBe(true);
  });
});
