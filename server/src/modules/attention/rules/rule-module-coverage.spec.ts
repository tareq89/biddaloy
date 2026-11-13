import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ModuleKey } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

// Every rule file must say which module it belongs to (D9). Source scan, so a rule that is
// not wired into a Nest module yet is still caught.
function ruleFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? ruleFiles(join(dir, e.name))
      : e.name.endsWith('.rule.ts')
        ? [join(dir, e.name)]
        : [],
  );
}

describe('attention rule module coverage', () => {
  const files = ruleFiles(__dirname);
  const allowed: string[] = ['core', ...Object.values(ModuleKey)];

  it('finds the rule files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files)('%s declares a known module', (f) => {
    const m = readFileSync(f, 'utf8').match(
      /@AttentionRule\(\{ module: (?:'(core)'|ModuleKey\.(\w+)) \}\)/,
    );
    expect(m, 'missing @AttentionRule({ module })').not.toBeNull();
    expect(allowed).toContain(m![1] ?? m![2]);
  });
});
