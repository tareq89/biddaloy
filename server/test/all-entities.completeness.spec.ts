import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { ALL_ENTITIES } from './all-entities';

/** Every `@Entity` class declared in a `*.entity.ts` file under src/, by class name. */
function entityClassesOnDisk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) entityClassesOnDisk(path, out);
    else if (name.endsWith('.entity.ts')) {
      const m = /@Entity\([^)]*\)[\s\S]*?export class (\w+)/.exec(readFileSync(path, 'utf8'));
      if (m) out.push(m[1]);
    }
  }
  return out;
}

describe('ALL_ENTITIES completeness', () => {
  const onDisk = entityClassesOnDisk(join(__dirname, '..', 'src')).sort();
  const listed = ALL_ENTITIES.map((e) => (e as { name: string }).name).sort();

  it('lists every @Entity class under src/', () => {
    const missing = onDisk.filter((n) => !listed.includes(n));
    // Fix: add the class to server/test/all-entities.ts (import + array entry).
    expect(missing, 'entities missing from ALL_ENTITIES').toEqual([]);
  });

  it('lists no class that is not an @Entity on disk', () => {
    const stale = listed.filter((n) => !onDisk.includes(n));
    expect(stale, 'ALL_ENTITIES entries with no @Entity file').toEqual([]);
  });
});
