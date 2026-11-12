import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPS_QUEUES } from './ops-queues';

const SRC = join(__dirname, '../../..');

/** Every `src` file (not a spec) that mentions `registerQueue`, via git so no walk is needed. */
function files(pattern: string): string[] {
  return execFileSync('git', ['grep', '-lE', pattern, '--', '*.ts', ':!*spec.ts'], {
    cwd: SRC,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .map((f) => join(SRC, f.replace(/^src\//, '')));
}

describe('OPS_QUEUES allow-list', () => {
  it('has no duplicates', () => {
    expect(new Set(OPS_QUEUES).size).toBe(OPS_QUEUES.length);
  });

  it('lists every queue name that any module registers (a new queue must be added)', () => {
    // Identifiers passed as `name: X` inside a `registerQueue(...)` call.
    const ids = new Set<string>();
    for (const f of files('registerQueue')) {
      const text = readFileSync(f, 'utf8');
      for (const call of text.matchAll(/registerQueue\(([\s\S]*?)\)\s*[,\]]/g)) {
        for (const m of call[1].matchAll(/name:\s*([A-Z][A-Z0-9_]+)/g)) ids.add(m[1]);
      }
    }
    expect(ids.size).toBeGreaterThan(20); // guards the regex itself going blind

    // Resolve each identifier to its string literal: `export const X = 'name'`.
    const registered = new Map<string, string>();
    for (const f of files('export const [A-Z_]+_QUEUE')) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/export const ([A-Z][A-Z0-9_]+)\s*=\s*'([^']+)'/g)) {
        if (ids.has(m[1])) registered.set(m[1], m[2]);
      }
    }
    // Every identifier must have resolved, else the spec would silently skip a queue.
    expect([...ids].filter((i) => !registered.has(i))).toEqual([]);

    const missing = [...registered.values()].filter((n) => !OPS_QUEUES.includes(n));
    expect(missing).toEqual([]);
  });
});
