import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { roles } from './content/roles';
import { shotName, shots } from '../scripts/shots.manifest.ts';

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) =>
    statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)],
  );

describe('shots manifest', () => {
  it('has unique names', () => {
    const names = shots.map(shotName);
    expect(new Set(names).size).toBe(names.length);
  });
  it('every carousel role points at a manifest shot', () => {
    const names = new Set(shots.map(shotName));
    for (const r of roles) expect(names.has(r.shotName), r.key).toBe(true);
  });
  it('every <Shot name="..."> used in pages exists in the manifest', () => {
    const names = new Set(shots.map(shotName));
    for (const f of walk(__dirname).filter((p) => p.endsWith('.astro'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/<Shot[^>]*\sname="([^"]+)"/g)) {
        expect(names.has(m[1]!), `${f}: ${m[1]}`).toBe(true);
      }
    }
  });
});
