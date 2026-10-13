// [75.28] Pure-function cases plus one check against the real tracked tree.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { findForbidden } from './check-tracked-files.mjs';

describe('findForbidden', () => {
  it.each([['.env'], ['server/.env'], ['.env.production']])('flags %s', (p) => {
    expect(findForbidden([p])).toEqual([p]);
  });

  it('allows the example env files', () => {
    expect(findForbidden(['.env.example', 'server/.env.test.example'])).toEqual([]);
  });

  it('flags drafts and audit evidence', () => {
    const p = ['drafts/a.html', 'audit-evidence/x.png'];
    expect(findForbidden(p)).toEqual(p);
  });

  it('flags planning/state files', () => {
    const p = ['.implement-epic-state-36.md', '.plan-epic-epic75-security.md', '.epic-8.5-state.md'];
    expect(findForbidden(p)).toEqual(p);
  });

  it('flags graphify output except the two root files', () => {
    expect(findForbidden(['server/graphify-out/graph.json', 'graphify-out/graph.json'])).toHaveLength(2);
    expect(findForbidden(['graphify-out/README.md', 'graphify-out/cost.json'])).toEqual([]);
  });

  it('ignores ordinary paths', () => {
    const p = ['server/src/main.ts', 'docs/architecture/08-security.md', '.github/workflows/ci.yml'];
    expect(findForbidden(p)).toEqual([]);
  });

  it('passes on the real repo', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\0')
      .filter(Boolean);
    expect(findForbidden(tracked)).toEqual([]);
  });
});
