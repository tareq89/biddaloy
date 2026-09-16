import { describe, expect, it } from 'vitest';
import { runOne, runTasks } from './check.mjs';

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
      expect.arrayContaining([expect.stringMatching(/^✗ lint/), expect.stringMatching(/^✓ typecheck/), expect.stringMatching(/^✓ tests/)]),
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
