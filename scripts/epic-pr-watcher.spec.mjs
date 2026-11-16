// Drives scripts/epic-pr-watcher.sh --dry-run against a fake `gh`, offline.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(dirname(fileURLToPath(import.meta.url)), 'epic-pr-watcher.sh');
const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

// threads: { <pr number>: unresolved CodeRabbit threads }
function run(prs, threads = {}, epic = 7) {
  const dir = mkdtempSync(join(tmpdir(), 'ew-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'prs.json'), JSON.stringify(prs));
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env bash
case "$1 $2" in
  "pr list") cat "${dir}/prs.json" ;;
  "api graphql") n=""; while [ $# -gt 0 ]; do [ "$1" = "-F" ] && n="\${2#n=}"; shift; done
                 case "$n" in ${Object.entries(threads).map(([k, v]) => `${k}) echo ${v};;`).join(' ')} *) echo 0;; esac ;;
  "pr view") echo 0 ;;
esac
`,
  );
  chmodSync(join(dir, 'gh'), 0o755);
  return execFileSync('bash', [script, String(epic), '--dry-run'], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TMPDIR: dir, QUEUE: '0' },
    encoding: 'utf8',
  });
}
const pr = (number, head, base, extra = {}) => ({
  number, headRefName: head, baseRefName: base, headRefOid: `sha${number}`, mergeable: 'MERGEABLE', labels: [], ...extra,
});

describe('epic-pr-watcher', () => {
  const stack = [pr(3, 'epic/7/pr3', 'epic/7/pr2'), pr(1, 'epic/7/pr1', 'main'), pr(2, 'epic/7/pr2', 'epic/7/pr1')];

  it('fixes the lowest PR first, regardless of list order', () => {
    expect(run(stack, { 2: 1, 3: 4 })).toMatch(/fixing #2 \(1 unresolved/);
  });
  it('treats a conflict as work', () => {
    const s = [pr(1, 'epic/7/pr1', 'main', { mergeable: 'CONFLICTING' })];
    expect(run(s)).toMatch(/fixing #1 \(merge conflict\)/);
  });
  it('does nothing when clean, and ignores other epics', () => {
    expect(run([...stack, pr(9, 'epic/8/pr1', 'main', { mergeable: 'CONFLICTING' })])).toMatch(/nothing to fix/);
  });
  it('stops at a needs-human PR', () => {
    const s = stack.map((p) => (p.number === 1 ? { ...p, labels: [{ name: 'needs-human' }] } : p));
    const out = run(s, { 2: 3 });
    expect(out).toMatch(/#1 is needs-human/);
    expect(out).not.toMatch(/fixing/);
  });
  it('reports done when no epic PR is open', () => {
    expect(run([])).toMatch(/no open PRs left/);
  });
});
