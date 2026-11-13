import { describe, it, expect } from 'vitest';
import { formatCutoverResult, parseCutoverArgs } from './platform-cutover';

const counts = { removed: 1, downgraded: 2, duplicatesRemoved: 0 };
const plan = [
  { userId: 'u1', tenantId: 't1', action: 'DOWNGRADE_TO_ADMIN' as const },
  { userId: 'u2', tenantId: 't2', action: 'REMOVE_MEMBERSHIP' as const },
];

describe('platform-cutover output', () => {
  it('says plainly that a dry run changed nothing and lists ids only', () => {
    const out = formatCutoverResult({ status: 'dry_run', counts, plan, sessionsCut: 2 }).join('\n');
    expect(out).toContain('DRY RUN: nothing was changed');
    expect(out).toContain('would be cut off: 2');
    expect(out).toContain('DOWNGRADE_TO_ADMIN user u1 school t1');
    expect(out).not.toMatch(/@/);
  });

  it('reports a real run and an already-done run', () => {
    expect(formatCutoverResult({ status: 'done', counts, plan: [], sessionsCut: 2 })[0]).toBe(
      'cutover done',
    );
    expect(
      formatCutoverResult({ status: 'already_done', counts, plan: [], sessionsCut: 0 }),
    ).toEqual(['cutover already done: nothing to change']);
  });
});

describe('platform-cutover arguments', () => {
  it('accepts nothing (real run) or exactly --dry-run, and refuses everything else', () => {
    expect(parseCutoverArgs([])).toEqual({ dryRun: false });
    expect(parseCutoverArgs(['--dry-run'])).toEqual({ dryRun: true });
    for (const bad of [['--dryrun'], ['--dry-run=true'], ['--dry-run', 'x'], ['dry-run'], ['-n']]) {
      expect(parseCutoverArgs(bad)).toBeNull();
    }
  });
});
