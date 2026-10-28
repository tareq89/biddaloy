// [#2954] docs/architecture numbers are unique, and CLAUDE.md links to them resolve.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const archDir = join(root, 'docs/architecture');

describe('docs/architecture', () => {
  it('has no two files sharing a numeric prefix', () => {
    const byNumber = {};
    for (const f of readdirSync(archDir)) {
      const m = /^(\d+)-.*\.md$/.exec(f);
      if (m) (byNumber[m[1]] ??= []).push(f);
    }
    expect(Object.values(byNumber).filter((l) => l.length > 1)).toEqual([]);
  });

  it('every docs/architecture/NN-name.md link in a CLAUDE.md resolves', () => {
    const files = execFileSync('git', ['ls-files', '*CLAUDE.md'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const missing = [];
    for (const f of files) {
      const text = readFileSync(join(root, f), 'utf8');
      for (const m of text.matchAll(/docs\/architecture\/(\d+-[\w-]+\.md)/g)) {
        if (!existsSync(join(archDir, m[1]))) missing.push(`${f} -> ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
