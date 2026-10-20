import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
  it('every <Shot name="..."> used in pages exists in the manifest', () => {
    const names = new Set(shots.map(shotName));
    for (const f of walk(__dirname).filter((p) => p.endsWith('.astro'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/<Shot[^>]*\sname="([^"]+)"/g)) {
        expect(names.has(m[1]!), `${f}: ${m[1]}`).toBe(true);
      }
    }
  });
});
